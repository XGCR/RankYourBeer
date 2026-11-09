"""Build BeerRanking's personal offline snapshot from LCBO's public website."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import sqlite3
import threading
import time
import unicodedata
from urllib.parse import urlsplit

from bs4 import BeautifulSoup
from lxml import html as lxml_html
from PIL import Image, ImageOps
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


SITE = "https://www.lcbo.com"
COLLECTION = SITE + "/en/collections/beer"
TERMS = SITE + "/content/lcbo/en/corporate-pages/terms-and-conditions.html"
SOURCE = {"label": "LCBO 官网", "url": COLLECTION, "license": "个人非商业参考"}
IMAGE_HOSTS = {"aem.lcbo.com", "www.lcbo.com"}
ROOT_CATEGORIES = ("Products|Beer", "Products|Non-Alcoholic|De-Alcoholized Beer")
VISIBLE = "@source=='ProductsEN' AND @enabled=='true' AND @ec_visibility==(2,4)"
PAGE_SIZE = 48
FIELDS = ["permanentid", "ec_name", "ec_category", "ec_brand", "upc", "ec_upc", "lcbo_upc",
          "lcbo_alcohol_percent", "lcbo_region_name", "country_of_manufacture"]
SESSION = threading.local()

STYLE_HINTS = (
    (r"\b(?:hazy|new england) ipa\b|\bneipa\b", "Hazy IPA"),
    (r"\b(?:double|imperial) (?:ipa|india pale ale)\b|\bdipa\b", "Double IPA"),
    (r"\b(?:ipa|india pale ale)\b", "IPA"),
    (r"\bimperial stout\b", "Imperial Stout"), (r"\bstout\b", "Stout"),
    (r"\bporter\b", "Porter"), (r"\bpils(?:ner|ener)?\b", "Pilsner"),
    (r"\bpale ale\b", "Pale Ale"), (r"\bcream ale\b", "Cream Ale"),
    (r"\b(?:wheat beer|wheat ale|witbier|hefeweizen)\b", "Wheat Beer"),
    (r"\b(?:sour|gose)\b", "Sour Beer"), (r"\bsaison\b", "Saison"),
    (r"\btripel\b", "Tripel"), (r"\bbock\b", "Bock"), (r"\bradler\b", "Radler"),
    (r"\blager\b", "Lager"), (r"\bale\b", "Ale"),
)
FLAVOR_HINTS = {
    "柑橘": r"\b(?:citrus|grapefruit|lemon|lime|orange|tangerine)\b",
    "热带水果": r"\b(?:tropical|mango|pineapple|passion ?fruit|guava)\b",
    "浆果": r"\b(?:berries|berry|raspberr\w+|strawberr\w+|blueberr\w+|blackberr\w+)\b",
    "花香": r"\b(?:floral|flowery)\b", "松针": r"\b(?:pine|piney|resinous|resin)\b",
    "焦糖": r"\b(?:caramel|toffee|butterscotch)\b", "烘烤": r"\b(?:roast\w*|toast\w*)\b",
    "咖啡": r"\b(?:coffee|espresso)\b", "巧克力": r"\b(?:chocolate|cocoa|cacao|mocha)\b",
    "香料": r"\b(?:spice[sd]?|spicy|coriander|cinnamon|cloves?)\b",
    "烟熏": r"\b(?:smoky|smoke|smoked)\b", "苦味": r"\b(?:bitter|bitterness)\b",
    "酸味": r"\b(?:sour|tart|acidity)\b", "谷物": r"\b(?:grain\w*|biscuit|bread|malty)\b",
    "蜂蜜": r"\bhoney\b", "香草": r"\bvanilla\b",
}


def clean(value):
    return " ".join(str(value or "").split())


def identity(value):
    decomposed = unicodedata.normalize("NFKD", clean(value)).casefold()
    normalized = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(re.findall(r"[^\W_]+", normalized))


def http():
    if not hasattr(SESSION, "value"):
        session = requests.Session()
        session.headers["User-Agent"] = "BeerRanking/0.2 (personal offline LCBO beer catalogue)"
        retry = Retry(total=2, backoff_factor=1, status_forcelist=(429, 500, 502, 503, 504))
        session.mount("https://", HTTPAdapter(max_retries=retry))
        SESSION.value = session
    return SESSION.value


def get(url, hosts, limit=4_000_000):
    response = http().get(url, timeout=(10, 24))
    response.raise_for_status()
    target = urlsplit(response.url)
    if target.scheme != "https" or target.hostname not in hosts or len(response.content) > limit:
        raise ValueError("Unexpected public resource")
    return response.content


def listing():
    html = get(COLLECTION, {"www.lcbo.com"})
    soup = BeautifulSoup(html, "lxml")
    expression = r'configureCloudV2Endpoint\(\s*"([a-z0-9]+)"\s*,\s*"([^"]+)"'
    configuration = next((match for script in soup.find_all("script") if "Web_Listing_EN" in script.get_text()
                          if (match := re.search(expression, script.get_text()))), None)
    if not configuration:
        raise ValueError("LCBO public search configuration not found.")
    org, browser_token = configuration.groups()
    endpoint = f"https://{org}.org.coveo.com/rest/search/v2"
    headers = {"Authorization": f"Bearer {browser_token}", "Origin": SITE}
    products, counts = {}, {}
    for category in ROOT_CATEGORIES:
        offset, expected = 0, None
        while expected is None or offset < expected:
            payload = {"q": "", "aq": VISIBLE + " AND @ec_category==" + repr(category),
                       "searchHub": "Web_Listing_EN", "tab": "clp-collections-beer",
                       "numberOfResults": PAGE_SIZE, "firstResult": offset, "locale": "en-CA",
                       "fieldsToInclude": FIELDS}
            response = http().post(endpoint, headers=headers, json=payload, timeout=(10, 25), allow_redirects=False)
            if response.status_code != 200:
                raise RuntimeError(f"LCBO search returned HTTP {response.status_code} at offset {offset}.")
            data = response.json()
            rows = data.get("results", [])
            if expected is None:
                expected = int(data["totalCountFiltered"])
                counts[category] = {"reported": expected, "received": 0}
            if not rows:
                break
            for row in rows:
                raw = row.get("raw", {})
                url = urlsplit(row.get("clickUri", ""))
                match = re.fullmatch(r"/en/[^/]+-(\d+)", url.path)
                if (url.scheme == "https" and url.netloc == "www.lcbo.com" and match
                        and str(raw.get("permanentid")) == match[1]):
                    products[match[1]] = {"sku": match[1], "url": SITE + url.path,
                                          **{key: raw[key] for key in FIELDS if key in raw}}
            counts[category]["received"] += len(rows)
            offset += len(rows)
            time.sleep(0.22)
        print(f"{category}: {counts[category]}", flush=True)
    if not products:
        raise ValueError("LCBO search returned no public beer products.")
    return {"categories": counts, "products": sorted(products.values(), key=lambda product: int(product["sku"]))}


def image_for(page, sku):
    # LCBO sets a generic social image ahead of the SKU-specific one.
    for url in reversed(page.xpath('//meta[@property="og:image"]/@content')):
        target = urlsplit(url)
        match = re.search(r"/(\d+)\.(?:jpg|jpeg|png)(?:\.|$)", target.path, re.I)
        if target.scheme == "https" and target.netloc in IMAGE_HOSTS and match and int(match[1]) == int(sku):
            return url.split("?", 1)[0]
    return None


def style_for(name, paths, profile):
    subtypes = [path.split("|")[-1] for path in paths
                if path.startswith("Products|Beer|") and path.count("|") >= 3]
    if subtypes:
        return re.sub(r"\bIpa\b", "IPA", subtypes[-1], flags=re.I)
    for pattern, label in STYLE_HINTS:
        if re.search(pattern, identity(name)):
            return label
    broad = [path.split("|")[-1] for path in paths if path in (
        "Products|Beer|Ale", "Products|Beer|Lager", ROOT_CATEGORIES[1],
    )]
    return broad[-1] if broad else profile


def number(value):
    match = re.fullmatch(r"(\d{1,2}(?:[.,]\d+)?)\s*%?", clean(value))
    return float(match[1].replace(",", ".")) if match else None


def class_is(value):
    return f'contains(concat(" ", normalize-space(@class), " "), " {value} ")'


def node_text(node):
    return clean(" ".join(node.itertext()))


def parse_product(product, html):
    page = lxml_html.fromstring(html, parser=lxml_html.HTMLParser(encoding="utf-8"))
    titles = page.xpath(f'//h1[{class_is("page-title")}]')
    canonical_urls = page.xpath('//meta[@property="og:url"]/@content')
    canonical = urlsplit(canonical_urls[0]) if canonical_urls else None
    canonical_sku = re.search(r"-(\d+)/?$", canonical.path) if canonical else None
    if (not titles or not canonical or canonical.scheme != "https" or canonical.netloc != "www.lcbo.com"
            or not canonical_sku or canonical_sku[1] != product["sku"]):
        raise ValueError("Official product page and indexed SKU differ")
    name = node_text(titles[0])
    if not name:
        raise ValueError("Product name is empty")
    tags = product.get("ec_category") or []
    if isinstance(tags, str):
        tags = [tags]
    if (any(tag.startswith(("Products|Cider", "Products|Coolers", "Products|Wine", "Products|Spirits")) for tag in tags)
            and not any(tag.startswith(("Products|Beer|Ale", "Products|Beer|Lager")) for tag in tags)):
        return None
    if re.search(r"\b(?:cider|seltzer|hard lemonade|variety pack|sampler pack|mix pack|mixed pack|sake)\b", identity(name)):
        return None
    fields = {}
    for item in page.xpath(f'//div[{class_is("pdp-moredetail-container")}]//li'):
        labels = item.xpath(f'.//div[{class_is("label")}]')
        values = item.xpath(f'.//div[{class_is("value")}]')
        if labels and values:
            fields[node_text(labels[0])] = node_text(values[0])
    notes = page.xpath(f'//div[{class_is("lcbo-product-details")}]//div[{class_is("testing_note")}]')
    tasting_notes = node_text(notes[0]) if notes else ""
    profile = fields.get("Style") or None
    abv = number(fields.get("Alcohol/Vol"))
    if abv is None:
        abv = number(product.get("lcbo_alcohol_percent"))
    origin = fields.get("Made In") or ", ".join(dict.fromkeys(filter(None, [
        clean(product.get("lcbo_region_name")), clean(product.get("country_of_manufacture")),
    ])))
    origin = re.sub(r"^Other,\s*", "", origin)
    barcode = next((code for key in ("upc", "ec_upc", "lcbo_upc")
                    if re.fullmatch(r"\d{8,14}", code := clean(product.get(key)))), None)
    package = page.xpath('//meta[@property="og:description"]/@content')
    return {
        "id": "", "name": name, "brand": fields.get("By") or clean(product.get("ec_brand")),
        "brewery": None, "style": style_for(name, tags, profile), "retailStyle": profile,
        "flavors": [label for label, pattern in FLAVOR_HINTS.items() if re.search(pattern, tasting_notes, re.I)],
        "tastingNotes": tasting_notes or None, "abv": abv, "origin": origin or None, "marketRegions": ["ON"],
        "barcodes": [barcode] if barcode else [], "lcboSkus": [product["sku"]],
        "sources": [{**SOURCE, "url": product["url"]}], "hasPhoto": False, "photoCredit": None,
        "_image": image_for(page, product["sku"]), "_package": package[0] if package else "",
    }


def read_product(product, cache, offline):
    path = cache / (product["sku"] + ".html.gz")
    try:
        if path.exists():
            html = gzip.decompress(path.read_bytes())
        elif offline:
            raise FileNotFoundError("page absent from cache")
        else:
            html = get(product["url"], {"www.lcbo.com"})
            path.write_bytes(gzip.compress(html, mtime=0))
            time.sleep(0.18)
        return parse_product(product, html), None
    except (requests.RequestException, OSError, ValueError) as error:
        return None, {"sku": product["sku"], "url": product["url"], "reason": str(error)[:240]}


def group_products(items):
    variants = defaultdict(list)
    for item in items:
        # Keep different named releases and ABVs distinct. Missing brand/ABV stays SKU-specific.
        key = (identity(item["brand"]), identity(item["name"]), item["abv"])
        if not key[0] or key[2] is None:
            key = (*key, item["lcboSkus"][0])
        variants[key].append(item)
    for key, group in variants.items():
        group.sort(key=lambda item: (
            not item["_image"], not item["tastingNotes"],
            bool(re.search(r"\b\d+\s*[x×]\s*\d+", item["_package"], re.I)),
            int(item["lcboSkus"][0]),
        ))
        primary = group[0]
        primary["id"] = "lcbo-" + hashlib.sha256(repr(key).encode()).hexdigest()[:24]
        primary["lcboSkus"] = sorted({sku for item in group for sku in item["lcboSkus"]}, key=int)
        primary["barcodes"] = sorted({code for item in group for code in item["barcodes"]})
        primary["sources"] = [item["sources"][0] for item in group]
        yield primary, [item["_image"] for item in group if item["_image"]]


def cover_for(group, cache, offline):
    entry, urls = group
    for url in dict.fromkeys(urls):
        path = cache / (hashlib.sha256(url.encode()).hexdigest() + ".img")
        try:
            if path.exists():
                data = path.read_bytes()
            elif offline:
                continue
            else:
                data = get(url, IMAGE_HOSTS)
                time.sleep(0.12)
            with Image.open(io.BytesIO(data)) as original:
                image = ImageOps.exif_transpose(original).convert("RGB")
            if not path.exists():
                path.write_bytes(data)
            outputs = []
            for limit in (720, 380):
                image.thumbnail((limit, limit))
                stream = io.BytesIO()
                image.save(stream, format="JPEG", quality=87, optimize=True)
                outputs.append(stream.getvalue())
            return outputs
        except (requests.RequestException, ValueError, OSError):
            continue
    return None


def build(args):
    args.cache.mkdir(parents=True, exist_ok=True)
    pages, images = args.cache / "pages", args.cache / "images"
    pages.mkdir(exist_ok=True)
    images.mkdir(exist_ok=True)
    index_file = args.cache / "index.json"
    if not index_file.exists() or args.refresh_index:
        if args.offline:
            raise ValueError("Offline mode needs a cached index.")
        index_file.write_text(json.dumps(listing(), ensure_ascii=False, indent=2), encoding="utf-8")
    index = json.loads(index_file.read_text(encoding="utf-8"))
    products = index["products"]
    items, failures = [], []
    excluded = 0
    with ThreadPoolExecutor(max_workers=5) as pool:
        for step, (item, failure) in enumerate(pool.map(lambda row: read_product(row, pages, args.offline), products), 1):
            if item:
                items.append(item)
            elif failure:
                failures.append(failure)
            else:
                excluded += 1
            if step % 100 == 0 or step == len(products):
                print(f"Pages {step}/{len(products)}: {len(items)} beer SKUs, {len(failures)} failed.", flush=True)
    if not items:
        raise ValueError("No verified LCBO beer product pages were available.")
    groups = list(group_products(items))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    temp = args.out.with_suffix(".tmp")
    temp.unlink(missing_ok=True)
    counts = Counter()
    try:
        with closing(sqlite3.connect(temp)) as db, db, ThreadPoolExecutor(max_workers=5) as pool:
            db.executescript("""
                PRAGMA application_id = 1112687425;
                PRAGMA user_version = 1;
                CREATE TABLE beers (id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
                CREATE TABLE covers (id TEXT PRIMARY KEY, cover BLOB NOT NULL, thumb BLOB NOT NULL) STRICT;
                CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
            """)
            downloads = pool.map(lambda group: cover_for(group, images, args.offline), groups)
            for step, ((entry, candidate_images), photo) in enumerate(zip(groups, downloads), 1):
                del entry["_image"], entry["_package"]
                if photo:
                    entry["hasPhoto"] = True
                    entry["photoCredit"] = {"label": "LCBO 商品包装照", "url": entry["sources"][0]["url"],
                                            "license": "个人非商业参考", "licenseUrl": TERMS}
                    db.execute("INSERT INTO covers VALUES (?, ?, ?)", (entry["id"], *photo))
                counts.update(field for field, present in {
                    "brand": entry["brand"], "style": entry["style"], "retailStyle": entry["retailStyle"],
                    "taste": entry["tastingNotes"], "photo": photo, "abv": entry["abv"] is not None,
                    "origin": entry["origin"], "barcode": entry["barcodes"], "imageCandidate": candidate_images,
                    "complete": entry["brand"] and entry["style"] and entry["tastingNotes"] and photo,
                }.items() if present)
                db.execute("INSERT INTO beers VALUES (?, ?)", (entry["id"], json.dumps(entry, ensure_ascii=False)))
                if step % 100 == 0 or step == len(groups):
                    print(f"Images {step}/{len(groups)}: {counts['photo']} verified photos.", flush=True)
            info = {"dataset": "lcbo", "version": args.as_of, "count": len(groups), "complete": counts["complete"],
                    "withStyle": counts["style"], "withFlavor": counts["taste"], "withPhoto": counts["photo"],
                    "sources": [SOURCE]}
            report = {"catalog": info, "retrievedOn": args.as_of, "index": index["categories"], "listedSkus": len(products),
                      "acceptedSkus": len(items), "excludedSkus": excluded, "mergedPackagingSkus": len(items) - len(groups),
                      "fields": dict(counts), "unavailablePages": failures}
            db.execute("INSERT INTO metadata VALUES (?, ?)", ("info", json.dumps(info, ensure_ascii=False)))
            db.execute("INSERT INTO metadata VALUES (?, ?)", ("audit", json.dumps(report, ensure_ascii=False)))
        temp.replace(args.out)
    finally:
        temp.unlink(missing_ok=True)
    args.out.with_name("coverage.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"listed": len(products), "accepted": len(items), "count": len(groups), "fields": counts,
                      "failed": len(failures), "excluded": excluded}, ensure_ascii=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--as-of", required=True, help="Date of the local LCBO snapshot")
    parser.add_argument("--cache", type=Path, default=Path(".data/lcbo"))
    parser.add_argument("--out", type=Path, default=Path("catalog/beer-catalog.sqlite"))
    parser.add_argument("--refresh-index", action="store_true")
    parser.add_argument("--offline", action="store_true", help="Use the local index, page and image cache")
    build(parser.parse_args())


if __name__ == "__main__":
    main()
