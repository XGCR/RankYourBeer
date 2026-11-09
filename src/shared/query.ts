import {
  emptyFilters, pageSize, type Entry, type Facet, type Filters, type Group,
  type GroupField, type Query, type Sort, type SortField, type ViewSettings,
} from './model.ts'

const collator = new Intl.Collator('zh-CN', { sensitivity: 'base', numeric: true })
export const facetFields = ['brands', 'styles', 'flavors', 'origins', 'regions'] as const
export const sortFields = ['score', 'name', 'brand', 'style', 'origin', 'abv', 'date'] as const

export function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').trim().toLowerCase()
}

export function complete(entry: Entry): boolean {
  return Boolean(entry.brand && entry.style && entry.tastingNotes && entry.hasPhoto)
}

const facetValues: Record<Facet, (entry: Entry) => (string | null)[]> = {
  brands: entry => [entry.brand],
  styles: entry => [entry.style],
  flavors: entry => entry.flavors,
  origins: entry => [entry.origin],
  regions: entry => entry.marketRegions,
}

export function collectFacets(entries: Entry[]): Record<Facet, string[]> {
  const facets = {} as Record<Facet, string[]>
  for (const field of facetFields) {
    const values = new Map<string, string>()
    for (const entry of entries) {
      for (const value of facetValues[field](entry)) {
        if (value && !values.has(normalize(value))) values.set(normalize(value), value)
      }
    }
    facets[field] = [...values.values()].sort(collator.compare)
  }
  return facets
}

function inRange(value: number | null, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true
  return value !== null && (min === null || value >= min) && (max === null || value <= max)
}

export function filterEntries(entries: Entry[], filters: Filters): Entry[] {
  const terms = normalize(filters.search).split(/\s+/).filter(Boolean)
  const activeFacets = facetFields.filter(field => filters[field].length).map(field => ({
    field,
    values: new Set(filters[field].map(normalize)),
  }))
  return entries.filter(entry => {
    if (terms.length) {
      const haystack = normalize([
        entry.name, entry.brand, entry.brewery, entry.style, entry.record?.review,
        entry.retailStyle, ...entry.flavors, ...entry.barcodes, ...(entry.lcboSkus ?? []),
      ].filter(Boolean).join(' '))
      if (!terms.every(term => haystack.includes(term))) return false
    }
    if (!activeFacets.every(({ field, values }) =>
      facetValues[field](entry).some(value => value !== null && values.has(normalize(value))),
    )) return false
    if (filters.status !== 'all' && Boolean(entry.record?.tasted) !== (filters.status === 'tasted')) return false
    if (filters.completeness !== 'all' && complete(entry) !== (filters.completeness === 'complete')) return false
    if (filters.cover !== 'all' && Boolean(entry.hasPhoto || entry.record?.hasPhoto) !== (filters.cover === 'has')) return false
    return inRange(entry.record?.score ?? null, filters.minScore, filters.maxScore)
      && inRange(entry.abv, filters.minAbv, filters.maxAbv)
  })
}

const sortValues: Record<SortField, (entry: Entry) => string | number | null> = {
  score: entry => entry.record?.score ?? null,
  name: entry => entry.name,
  brand: entry => entry.brand,
  style: entry => entry.style,
  origin: entry => entry.origin,
  abv: entry => entry.abv,
  date: entry => entry.record?.date ?? null,
}

export function sortEntries(entries: Entry[], primary: Sort, secondary: Sort | null): Entry[] {
  function compare(a: Entry, b: Entry, sort: Sort) {
    const left = sortValues[sort.field](a)
    const right = sortValues[sort.field](b)
    if (left === null || right === null) return Number(left === null) - Number(right === null)
    const result = typeof left === 'number' && typeof right === 'number'
      ? left - right : collator.compare(String(left), String(right))
    return sort.direction === 'desc' ? -result : result
  }
  return [...entries].sort((a, b) =>
    compare(a, b, primary) || (secondary ? compare(a, b, secondary) : 0)
    || collator.compare(a.name, b.name) || a.id.localeCompare(b.id),
  )
}

export function groupEntries(entries: Entry[], field: GroupField): Group[] {
  const buckets = new Map<string, { label: string | null; count: number; scored: number; sum: number }>()
  for (const entry of entries) {
    const label = entry[field]
    const key = normalize(label ?? '')
    const bucket = buckets.get(key) ?? { label, count: 0, scored: 0, sum: 0 }
    bucket.count += 1
    const score = entry.record?.score
    if (score != null) {
      bucket.sum += score
      bucket.scored += 1
    }
    buckets.set(key, bucket)
  }
  return [...buckets.values()].map(({ sum, scored, ...group }) => ({
    ...group, scored, average: scored ? sum / scored : null,
  })).sort((a, b) => (b.average ?? -1) - (a.average ?? -1)
    || b.scored - a.scored || collator.compare(a.label ?? '', b.label ?? ''))
}

export function queryEntries(entries: Entry[], query: Query) {
  const scope = query.mode === 'discover' ? entries : entries.filter(entry => entry.record)
  const filtered = filterEntries(scope, query.filters)
  const ranked = query.mode === 'ranking' && !query.group
    ? filtered.filter(entry => entry.record?.score != null) : filtered
  const sorted = sortEntries(ranked, query.primary, query.secondary)
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const page = Math.min(pageCount, query.page)
  return {
    sorted, page, pageCount,
    facets: collectFacets(scope),
    groups: query.group ? groupEntries(filtered, query.group) : [],
    rows: sorted.slice((page - 1) * pageSize, page * pageSize),
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function optionalNumber(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null
}

function sortValue(input: unknown): Sort | null {
  const { field, direction } = object(input)
  return sortFields.includes(field as SortField) && (direction === 'asc' || direction === 'desc')
    ? { field: field as SortField, direction } : null
}

export function cleanSettings(input: unknown): ViewSettings {
  const { filters, primary, secondary } = object(input)
  const raw = object(filters)
  const result = { ...emptyFilters }
  for (const field of facetFields) {
    const values = raw[field]
    if (Array.isArray(values)) {
      result[field] = values.filter((value): value is string =>
        typeof value === 'string' && value.length > 0 && value.length <= 250,
      ).slice(0, 100)
    }
  }
  result.search = typeof raw.search === 'string' ? raw.search.slice(0, 250) : ''
  if (raw.status === 'tasted' || raw.status === 'untasted') result.status = raw.status
  if (raw.completeness === 'complete' || raw.completeness === 'missing') result.completeness = raw.completeness
  if (raw.cover === 'has' || raw.cover === 'none') result.cover = raw.cover
  result.minScore = optionalNumber(raw.minScore, 10)
  result.maxScore = optionalNumber(raw.maxScore, 10)
  result.minAbv = optionalNumber(raw.minAbv, 100)
  result.maxAbv = optionalNumber(raw.maxAbv, 100)
  const first = sortValue(primary) ?? { field: 'name', direction: 'asc' }
  const second = sortValue(secondary)
  return { filters: result, primary: first, secondary: second?.field === first.field ? null : second }
}

export function cleanQuery(input: unknown): Query {
  const { mode, page, group } = object(input)
  return {
    ...cleanSettings(input),
    mode: mode === 'library' || mode === 'ranking' ? mode : 'discover',
    group: mode === 'ranking' && (group === 'brand' || group === 'style' || group === 'origin') ? group : null,
    page: typeof page === 'number' && Number.isSafeInteger(page) && page > 0 ? page : 1,
  }
}

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return ''
  const text = typeof value === 'string' && /^[\s]*[=+\-@\t\r]/u.test(value) ? "'" + value : String(value)
  return '"' + text.replaceAll('"', '""') + '"'
}

export function makeCsv(rows: Entry[]): string {
  const header = ['酒名', '品牌', '酒厂', '风格', 'LCBO 风味风格', '口味', '酒精度 (%)', '产地', 'LCBO 商品编号', '加拿大地区依据', '状态', '评分', '日期', '短评', '来源']
  const lines = rows.map(entry => [
    entry.name, entry.brand, entry.brewery, entry.style, entry.retailStyle, entry.flavors.join('、'), entry.abv, entry.origin, entry.lcboSkus?.join('、'),
    entry.marketRegions.join('、'), entry.record?.tasted ? '已喝' : entry.record ? '待尝' : '图鉴',
    entry.record?.score, entry.record?.date, entry.record?.review, entry.sources.map(source => source.url).join(' '),
  ])
  return csvDocument([header, ...lines])
}

export function makeGroupCsv(groups: Group[], field: GroupField): string {
  const label = { brand: '品牌', style: '风格', origin: '产地' }[field]
  return csvDocument([[label, '匹配酒款', '已评分', '平均分 / 10'],
    ...groups.map(group => [group.label ?? '资料待补充', group.count, group.scored,
      group.average === null ? null : Number(group.average.toFixed(2))]),
  ])
}

function csvDocument(lines: (string | number | null | undefined)[][]): string {
  return '\uFEFF' + lines.map(line => line.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
