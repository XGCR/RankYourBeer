export interface Source {
  label: string
  url: string
  license: string
}

export interface PhotoCredit {
  label: string
  url: string
  license: string
  licenseUrl: string
}

export const categoryLabels = {
  beer: '啤酒', cider: '苹果酒', wine: '葡萄酒', spirits: '烈酒', rtd: '即饮酒', 'non-alcoholic': '无醇饮品',
}
export type Category = keyof typeof categoryLabels

export interface LcboPackage {
  sku: string
  size: string
  regularPriceCents: number | null
}

export interface Beer {
  id: string
  name: string
  brand: string
  category?: Category
  brewery: string | null
  style: string | null
  retailStyle?: string | null
  flavors: string[]
  tastingNotes: string | null
  abv: number | null
  origin: string | null
  marketRegions: string[]
  barcodes: string[]
  lcboSkus?: string[]
  lcboPackages?: LcboPackage[]
  onlinePhotoUrl?: string
  sources: Source[]
  hasPhoto: boolean
  photoCredit: PhotoCredit | null
}

export interface RecordSummary {
  tasted: boolean
  score: number | null
  review: string
  date: string | null
  hasPhoto: boolean
}

export interface Entry extends Beer {
  record: RecordSummary | null
}

export type Mode = 'discover' | 'library' | 'ranking'
export type SortField = 'score' | 'name' | 'brand' | 'style' | 'origin' | 'abv' | 'price' | 'date'
export type GroupField = 'brand' | 'style' | 'origin'
export type Facet = 'categories' | 'brands' | 'styles' | 'flavors' | 'origins' | 'regions'
export interface Sort {
  field: SortField
  direction: 'asc' | 'desc'
}

export interface Filters {
  search: string
  categories: string[]
  brands: string[]
  styles: string[]
  flavors: string[]
  origins: string[]
  regions: string[]
  status: 'all' | 'tasted' | 'untasted'
  completeness: 'all' | 'complete' | 'missing'
  cover: 'all' | 'has' | 'none'
  minScore: number | null
  maxScore: number | null
  minAbv: number | null
  maxAbv: number | null
  minPrice: number | null
  maxPrice: number | null
}

export interface ViewSettings {
  filters: Filters
  primary: Sort
  secondary: Sort | null
}

export interface Query extends ViewSettings {
  mode: Mode
  page: number
  group: GroupField | null
}

export interface Group {
  label: string | null
  count: number
  scored: number
  average: number | null
}

export interface CatalogInfo {
  dataset: 'lcbo'
  version: string
  count: number
  complete: number
  withStyle: number
  withFlavor: number
  withPhoto: number
  withPrice?: number
  withOfflinePhoto?: number
  sources: Source[]
}

export interface View {
  rows: Entry[]
  total: number
  page: number
  pageCount: number
  facets: Record<Facet, string[]>
  groups: Group[]
  catalog: CatalogInfo
  libraryCount: number
  tastedCount: number
  scoredCount: number
}

export interface Preset extends ViewSettings {
  name: string
}

export interface Draft {
  id: string | null
  name: string
  brand: string
  style: string
  origin: string
  abv: number | null
  tasted: boolean
  score: number | null
  review: string
  date: string | null
  photo: { action: 'keep' | 'remove' } | { action: 'replace'; token: string }
}

export interface DesktopApi {
  view(query: Query): Promise<View>
  entry(id: string): Promise<Entry | null>
  save(draft: Draft): Promise<string>
  remove(id: string): Promise<void>
  pickPhoto(): Promise<{ token: string; preview: string } | null>
  presets(): Promise<Preset[]>
  savePreset(preset: Preset): Promise<Preset[]>
  removePreset(name: string): Promise<Preset[]>
  exportCsv(query: Query): Promise<boolean>
  backup(): Promise<boolean>
  restore(): Promise<boolean>
  updateCatalog(): Promise<CatalogInfo | null>
  openSource(url: string): Promise<void>
}

export const emptyFilters: Filters = {
  search: '', categories: [], brands: [], styles: [], flavors: [], origins: [], regions: [],
  status: 'all', completeness: 'all', cover: 'all',
  minScore: null, maxScore: null, minAbv: null, maxAbv: null, minPrice: null, maxPrice: null,
}

export const pageSize = 36

export const regions: Record<string, string> = {
  AB: '阿尔伯塔', BC: '不列颠哥伦比亚', MB: '曼尼托巴', NB: '新不伦瑞克',
  NL: '纽芬兰和拉布拉多', NS: '新斯科舍', NT: '西北地区', NU: '努纳武特',
  ON: '安大略', PE: '爱德华王子岛', QC: '魁北克', SK: '萨斯喀彻温', YT: '育空',
}
