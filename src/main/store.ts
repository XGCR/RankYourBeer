import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { Beer, CatalogInfo, Draft, Entry, Preset, RecordSummary } from '../shared/model.ts'
import { cleanSettings, normalize } from '../shared/query.ts'

export const catalogApplicationId = 0x42524341
export const libraryApplicationId = 0x42524c42
const schemaVersion = 1
const maxPhotoBytes = 8 * 1024 * 1024
export const validId = /^[a-z0-9][a-z0-9-]{0,79}$/

export interface Photo {
  cover: Uint8Array
  thumb: Uint8Array
}

interface PersonalRecord {
  beer: Beer
  tasting: Omit<RecordSummary, 'hasPhoto'>
}

type LibraryRow = { id: string; body: string; has_photo: number }
type FullLibraryRow = LibraryRow & { cover: Uint8Array | null; thumb: Uint8Array | null }
type PresetRow = { name: string; body: string }

export function lcboUrl(value: string): URL | null {
  const url = URL.parse(value)
  return url?.protocol === 'https:' && url.host === 'www.lcbo.com' && !url.username && !url.password ? url : null
}

function productSku(value: string): string | undefined {
  return lcboUrl(value)?.pathname.match(/^\/en\/[^/]+-(\d+)$/)?.[1]
}

function checkDatabase(db: DatabaseSync, applicationId: number, tables: string[], checkIntegrity: boolean) {
  const names = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map(row => row.name)
  if (db.prepare('PRAGMA application_id').get()?.application_id !== applicationId
    || db.prepare('PRAGMA user_version').get()?.user_version !== schemaVersion
    || !tables.every(name => names.includes(name))) {
    throw new Error('文件类型或版本不兼容。')
  }
  if (checkIntegrity && db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') {
    throw new Error('文件校验失败。')
  }
}

function withTransaction(db: DatabaseSync, work: () => void) {
  db.exec('BEGIN IMMEDIATE')
  try {
    work()
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function checkBeer(beer: Beer, id: string): boolean {
  return Boolean(beer && beer.id === id && validId.test(id)
    && typeof beer.name === 'string' && beer.name.length > 0
    && typeof beer.brand === 'string'
    && [beer.brewery, beer.style, beer.origin, beer.tastingNotes].every(value => value === null || typeof value === 'string')
    && (beer.abv === null || (Number.isFinite(beer.abv) && beer.abv >= 0 && beer.abv <= 100))
    && [beer.barcodes, beer.marketRegions, beer.flavors].every(values =>
      Array.isArray(values) && values.every(value => typeof value === 'string'),
    )
    && Array.isArray(beer.sources) && beer.sources.every(source =>
      source && typeof source.label === 'string' && typeof source.url === 'string' && typeof source.license === 'string',
    )
    && (beer.retailStyle == null || typeof beer.retailStyle === 'string')
    && (beer.lcboSkus === undefined || (Array.isArray(beer.lcboSkus) && beer.lcboSkus.every(sku => typeof sku === 'string' && /^\d+$/.test(sku))))
    && typeof beer.hasPhoto === 'boolean'
    && (beer.photoCredit === null || ['label', 'url', 'license', 'licenseUrl'].every(key =>
      typeof beer.photoCredit?.[key as keyof typeof beer.photoCredit] === 'string',
    )))
}

export class CatalogStore {
  readonly db: DatabaseSync
  readonly entries: Map<string, Beer>
  readonly info: CatalogInfo

  constructor(path: string, verify = false) {
    const db = new DatabaseSync(path, { readOnly: true })
    this.db = db
    try {
      db.exec('PRAGMA trusted_schema=OFF')
      checkDatabase(db, catalogApplicationId, ['beers', 'covers', 'metadata'], verify)
      const meta = db.prepare("SELECT value FROM metadata WHERE key = 'info'").get()
      this.info = JSON.parse(String(meta?.value)) as CatalogInfo
      if (this.info.dataset !== 'lcbo' || !Array.isArray(this.info.sources) || !this.info.sources.length
        || this.info.sources.some(source => !lcboUrl(source.url))) {
        throw new Error('请选择 LCBO 官网目录数据包。')
      }
      this.entries = new Map()
      for (const row of db.prepare('SELECT id, body FROM beers').iterate()) {
        const id = String(row.id)
        const beer = JSON.parse(String(row.body)) as Beer
        if (!checkBeer(beer, id) || !beer.lcboSkus?.length || !beer.sources.length
          || beer.sources.some(source => !beer.lcboSkus!.includes(productSku(source.url) ?? ''))
          || beer.hasPhoto !== Boolean(beer.photoCredit)
          || (beer.photoCredit && (!productSku(beer.photoCredit.url) || !lcboUrl(beer.photoCredit.licenseUrl)))) {
          throw new Error('LCBO 商品或来源格式无效。')
        }
        this.entries.set(id, beer)
      }
      if (typeof this.info.version !== 'string' || !Array.isArray(this.info.sources)
        || this.entries.size !== this.info.count) throw new Error('目录信息与条目数量不符。')
      if (verify) {
        const photoIds = new Set(db.prepare('SELECT id FROM covers').all().map(row => row.id))
        if ([...this.entries.values()].some(beer => beer.hasPhoto !== photoIds.has(beer.id))
          || photoIds.size !== this.info.withPhoto
          || db.prepare("SELECT 1 FROM covers WHERE hex(substr(cover, 1, 3)) != 'FFD8FF' OR hex(substr(thumb, 1, 3)) != 'FFD8FF' LIMIT 1").get()) {
          throw new Error('目录照片与酒款索引不符。')
        }
      }
    } catch (error) {
      db.close()
      throw error
    }
  }

  photo(id: string, thumb: boolean): Uint8Array | null {
    const column = thumb ? 'thumb' : 'cover'
    const row = this.db.prepare('SELECT ' + column + ' AS photo FROM covers WHERE id = ?').get(id)
    return (row?.photo as Uint8Array | undefined) ?? null
  }

  close() {
    this.db.close()
  }
}

function text(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || value.trim().length > max) throw new Error(label + '格式或长度无效。')
  return value.trim()
}

function isScore(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && value >= 0 && value <= 10 && Number.isInteger(value * 2))
}

function isDate(value: unknown): value is string | null {
  if (value === null) return true
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(value + 'T00:00:00Z')
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

function decodeRecord(row: LibraryRow): Entry {
  const parsed = JSON.parse(row.body) as PersonalRecord
  const { beer, tasting } = parsed
  if (!checkBeer(beer, row.id) || !tasting || typeof tasting.tasted !== 'boolean'
    || !isScore(tasting.score) || !isDate(tasting.date) || typeof tasting.review !== 'string'
    || tasting.review.length > 1000 || (!tasting.tasted && (tasting.score !== null || tasting.date !== null || tasting.review))) {
    throw new Error('个人品饮记录格式无效。')
  }
  return { ...beer, record: { ...tasting, hasPhoto: Boolean(row.has_photo) } }
}

function validPhoto(value: Uint8Array | null): boolean {
  return value === null || (value instanceof Uint8Array && value.length <= maxPhotoBytes
    && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff)
}

export class LibraryStore {
  readonly db: DatabaseSync

  constructor(path: string) {
    const db = new DatabaseSync(path)
    this.db = db
    db.exec('PRAGMA trusted_schema=OFF')
    if (db.prepare('PRAGMA application_id').get()?.application_id === 0) {
      withTransaction(db, () => db.exec(`
        CREATE TABLE library (id TEXT PRIMARY KEY, body TEXT NOT NULL, cover BLOB, thumb BLOB) STRICT;
        CREATE TABLE presets (name TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
        PRAGMA application_id = ${libraryApplicationId};
        PRAGMA user_version = ${schemaVersion};
      `))
    }
    checkDatabase(db, libraryApplicationId, ['library', 'presets'], false)
  }

  all(): Map<string, Entry> {
    const rows = this.db.prepare('SELECT id, body, thumb IS NOT NULL AS has_photo FROM library').all() as LibraryRow[]
    return new Map(rows.map(row => [row.id, decodeRecord(row)]))
  }

  relink(catalog: Map<string, Beer>) {
    const records = this.all()
    const orphaned = [...records.values()].filter(entry => !entry.id.startsWith('personal-') && !catalog.has(entry.id))
    if (!orphaned.length) return

    const identifiers = new Map<string, Set<Beer>>()
    const names = new Map<string, Set<Beer>>()
    for (const beer of catalog.values()) {
      for (const key of linkIdentifiers(beer)) indexBeer(identifiers, key, beer)
      if (beer.brand) indexBeer(names, linkName(beer), beer)
    }
    const candidates = new Map<string, { beer: Beer; previous: Entry }[]>()
    for (const previous of orphaned) {
      const exact = new Set(linkIdentifiers(previous).flatMap(key => [...(identifiers.get(key) ?? [])]))
      const matching = exact.size ? [...exact] : [...(names.get(linkName(previous)) ?? [])].filter(beer =>
        previous.abv === null || beer.abv === null || Math.abs(previous.abv - beer.abv) <= 0.15,
      )
      if (matching.length !== 1 || records.has(matching[0].id)) continue
      const beer = matching[0]
      const proposals = candidates.get(beer.id) ?? []
      proposals.push({ beer, previous })
      candidates.set(beer.id, proposals)
    }
    const unique = [...candidates.values()].filter(proposals => proposals.length === 1).map(proposals => proposals[0])
    if (!unique.length) return
    withTransaction(this.db, () => {
      const move = this.db.prepare('UPDATE library SET id = ?, body = ? WHERE id = ?')
      for (const { beer, previous } of unique) {
        const { hasPhoto: _photo, ...tasting } = previous.record!
        move.run(beer.id, JSON.stringify({ beer, tasting } satisfies PersonalRecord), previous.id)
      }
    })
  }

  get(id: string): Entry | null {
    const row = this.db.prepare('SELECT id, body, thumb IS NOT NULL AS has_photo FROM library WHERE id = ?')
      .get(id) as LibraryRow | undefined
    return row ? decodeRecord(row) : null
  }

  save(draft: Draft, knownBeer: Beer | null, photo?: Photo): string {
    if (typeof draft.tasted !== 'boolean' || !isScore(draft.score) || !isDate(draft.date)) {
      throw new Error('请检查品饮日期和评分。评分以 0.5 为一档。')
    }
    const id = knownBeer?.id ?? draft.id ?? 'personal-' + randomUUID()
    if (!validId.test(id)) throw new Error('酒款编号无效。')
    const old = this.get(id)
    if (!knownBeer && draft.id && !old) throw new Error('该酒款已被移除。')
    const existing = knownBeer ?? old
    let beer: Beer
    if (existing && !id.startsWith('personal-')) {
      const { record: _record, ...data } = existing as Entry
      beer = data
    } else {
      const name = text(draft.name, 160, '酒名')
      const brand = text(draft.brand, 160, '品牌')
      if (!name || !brand) throw new Error('请填写酒名和品牌。')
      if (draft.abv !== null && (!Number.isFinite(draft.abv) || draft.abv < 0 || draft.abv > 100)) {
        throw new Error('酒精度须介于 0% 和 100%。')
      }
      beer = {
        id, name, brand, brewery: null, style: text(draft.style, 100, '风格') || null,
        origin: text(draft.origin, 100, '产地') || null, abv: draft.abv, flavors: [], tastingNotes: null,
        barcodes: [], marketRegions: [], sources: [], hasPhoto: false, photoCredit: null,
      }
    }
    const action = draft.photo?.action
    if (action !== 'keep' && action !== 'replace' && action !== 'remove') throw new Error('照片操作无效。')
    if (action === 'replace' && !photo) throw new Error('照片已失效，请重新选取。')
    const body: PersonalRecord = {
      beer,
      tasting: {
        tasted: draft.tasted, score: draft.tasted ? draft.score : null,
        review: draft.tasted ? text(draft.review, 1000, '短评') : '', date: draft.tasted ? draft.date : null,
      },
    }
    const update = action === 'keep' ? 'body = excluded.body'
      : 'body = excluded.body, cover = excluded.cover, thumb = excluded.thumb'
    this.db.prepare(`
      INSERT INTO library (id, body, cover, thumb) VALUES (?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET ${update}
    `).run(id, JSON.stringify(body), photo?.cover ?? null, photo?.thumb ?? null)
    return id
  }

  remove(id: string) {
    this.db.prepare('DELETE FROM library WHERE id = ?').run(id)
  }

  photo(id: string, thumb: boolean): Uint8Array | null {
    const column = thumb ? 'thumb' : 'cover'
    const row = this.db.prepare('SELECT ' + column + ' AS photo FROM library WHERE id = ?').get(id)
    return (row?.photo as Uint8Array | null | undefined) ?? null
  }

  presets(): Preset[] {
    return (this.db.prepare('SELECT name, body FROM presets ORDER BY name COLLATE NOCASE').all() as PresetRow[])
      .map(({ name, body }) => ({ name, ...cleanSettings(JSON.parse(body)) }))
  }

  savePreset(preset: Preset): Preset[] {
    const name = text(preset.name, 60, '预设名称')
    if (!name) throw new Error('请填写预设名称。')
    this.db.prepare('INSERT OR REPLACE INTO presets (name, body) VALUES (?, ?)').run(name, JSON.stringify(cleanSettings(preset)))
    return this.presets()
  }

  removePreset(name: string): Preset[] {
    this.db.prepare('DELETE FROM presets WHERE name = ?').run(name)
    return this.presets()
  }

  restore(path: string, beforeReplace: () => boolean): boolean {
    const source = new DatabaseSync(path, { readOnly: true })
    try {
      source.exec('PRAGMA trusted_schema=OFF; BEGIN')
      checkDatabase(source, libraryApplicationId, ['library', 'presets'], true)
      const rows = source.prepare('SELECT id, body, thumb IS NOT NULL AS has_photo, cover, thumb FROM library')
      const presets = source.prepare('SELECT name, body FROM presets').all() as PresetRow[]
      for (const row of rows.iterate() as Iterable<FullLibraryRow>) {
        decodeRecord(row)
        if (!validPhoto(row.cover) || !validPhoto(row.thumb) || Boolean(row.cover) !== Boolean(row.thumb)) {
          throw new Error('备份中的个人照片格式无效。')
        }
      }
      for (const preset of presets) {
        if (!text(preset.name, 60, '预设名称')) throw new Error('备份中的预设名称无效。')
        cleanSettings(JSON.parse(preset.body))
      }
      if (!beforeReplace()) return false
      withTransaction(this.db, () => {
        this.db.exec('DELETE FROM library; DELETE FROM presets')
        const insert = this.db.prepare('INSERT INTO library (id, body, cover, thumb) VALUES (?, ?, ?, ?)')
        for (const row of rows.iterate() as Iterable<FullLibraryRow>) {
          insert.run(row.id, row.body, row.cover, row.thumb)
        }
        const savePreset = this.db.prepare('INSERT INTO presets (name, body) VALUES (?, ?)')
        for (const preset of presets) savePreset.run(preset.name, preset.body)
      })
      return true
    } finally {
      source.close()
    }
  }
}

function linkIdentifiers(beer: Beer): string[] {
  const skus = [...(beer.lcboSkus ?? []), ...beer.sources.flatMap(source => productSku(source.url) ?? [])]
  return [...skus.map(sku => 'sku:' + sku), ...beer.barcodes.filter(code => /^\d{8,14}$/.test(code))
    .map(code => 'upc:' + code.replace(/^0+/, ''))]
}

function linkName(beer: Beer): string {
  return normalize(beer.brand) + '\n' + normalize(beer.name)
}

function indexBeer(index: Map<string, Set<Beer>>, key: string, beer: Beer) {
  const matches = index.get(key) ?? new Set<Beer>()
  matches.add(beer)
  index.set(key, matches)
}

export function mergeEntries(catalog: Map<string, Beer>, library: Map<string, Entry>): Entry[] {
  return [
    ...[...catalog.values()].map(beer => ({ ...beer, record: library.get(beer.id)?.record ?? null })),
    ...[...library.values()].filter(beer => !catalog.has(beer.id)).map(beer => beer.id.startsWith('personal-') ? beer : ({
      ...beer, brewery: null, style: null, retailStyle: null, abv: null, origin: null,
      barcodes: [], lcboSkus: [], flavors: [], tastingNotes: null, marketRegions: [], sources: [],
      hasPhoto: false, photoCredit: null,
    })),
  ]
}

export function sameBeer(entry: Beer, name: string, brand: string): boolean {
  return normalize(entry.name) === normalize(name) && normalize(entry.brand) === normalize(brand)
}
