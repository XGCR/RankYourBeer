# BeerRanking

BeerRanking 是简体中文的 Windows 11 x64 离线啤酒图鉴和个人品饮软件。公共图鉴统一采用 LCBO 官网商品页，包括安大略零售目录收录的本地酒、进口酒和无醇啤酒。[LCBO 图鉴覆盖报告](docs/catalog-coverage.md)

## 使用

1. 完成下文的本地目录生成和打包后，运行 `release/BeerRanking-Setup-0.2.0-x64.exe`，从 Windows 开始菜单打开 BeerRanking。安装程序为个人非商业使用准备。
2. 在「发现图鉴」按品牌、风格、口味或产地筛选。搜索也接受 LCBO 商品编号。打开酒款可查看包装照、酒精度、产地、官方品鉴描述及不同包装对应的商品链接。
3. 将酒款加入「我的酒单」，也可手动录入。标记为已喝后可填写 0–10 分评分、短评和品饮日期。每款酒可保存一张 JPG 或 PNG 个人封面。
4. 在「评分排行」查看单品榜或分类平均分。在「数据」中导出当前筛选结果、备份和恢复个人酒单，或加载 LCBO 离线目录包。

个人库位于 `%APPDATA%\BeerRanking\library.sqlite`。升级时按 LCBO 商品编号、条码或唯一的品牌与酒名重新关联个人记录。无法可靠匹配的酒款保留在个人酒单。备份包含评分、短评、日期、个人封面和筛选预设。

## 开发与打包

在 Windows x64 上使用 Node.js 24。从 GitHub 克隆源码后，先按下文生成本地目录。安装、运行和桌面测试使用本机的 `catalog/beer-catalog.sqlite`。

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
npm.cmd test
npm.cmd run test:desktop
npm.cmd run dist
```

首次获取 Electron 和 NSIS 构建依赖需要联网。安装程序包含运行时、LCBO 目录和本地包装照。

## 更新 LCBO 目录

使用 Python 3.11 安装 `scripts/requirements-catalog.txt`。脚本从 LCBO 官网公开列表取得商品链接，逐款解析官方页面。为新快照使用新的缓存目录和采集日期。采集完毕后可用 `--offline` 根据同一份缓存重建。生成的目录及包装照仅供个人非商业离线参考。[LCBO 啤酒集合](https://www.lcbo.com/en/collections/beer) · [LCBO 使用条款](https://www.lcbo.com/content/lcbo/en/corporate-pages/terms-and-conditions.html)

```powershell
python -m pip install -r scripts/requirements-catalog.txt
$date = Get-Date -Format yyyy-MM-dd
$catalog = ".data/lcbo-$date/beer-catalog.sqlite"
python scripts/build_lcbo_catalog.py --as-of $date --cache ".data/lcbo-$date" --out $catalog
Copy-Item $catalog -Destination catalog/beer-catalog.sqlite
```

从软件的「数据 → 加载离线目录包」选择生成的 SQLite 文件，或将其放在 `catalog/beer-catalog.sqlite` 再打包。

[数据与图片来源](catalog/ATTRIBUTION.txt) · [机器可读覆盖数据](catalog/coverage.json)
