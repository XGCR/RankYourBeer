import { Check, ChevronDown, Plus, Search, SlidersHorizontal, Star, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { emptyFilters, regions, type Facet, type Filters, type Preset, type Query, type SortField, type View, type ViewSettings } from '../shared/model.ts'
import { facetFields, normalize, sortFields } from '../shared/query.ts'

export const facetLabels: Record<Facet, string> = {
  brands: '品牌 / 酒厂', styles: '风格', flavors: '口味', origins: '产地', regions: '目录地区',
}
const sortLabels: Record<SortField, string> = {
  score: '评分', name: '酒名', brand: '品牌', style: '风格', origin: '产地', abv: '酒精度', date: '品饮日期',
}
const options = {
  status: { all: '全部状态', tasted: '已喝', untasted: '待尝' },
  completeness: { all: '全部资料', complete: '资料完整', missing: '有待补全' },
  cover: { all: '全部封面', has: '有封面', none: '无封面' },
}
type RangeField = 'minScore' | 'maxScore' | 'minAbv' | 'maxAbv'
type ToggleField = keyof typeof options

export function facetLabel(field: Facet, value: string): string {
  return field === 'regions' ? regions[value] ?? value : value
}

function FacetMenu({ field, values, active, onChange }: {
  field: Facet; values: string[]; active: string[]; onChange: (values: string[]) => void
}) {
  const [search, setSearch] = useState('')
  const choices = [...new Set([...active, ...values])].filter(value =>
    normalize(facetLabel(field, value) + ' ' + value).includes(normalize(search)),
  )
  return <details className="dropdown">
    <summary className={'button outline small' + (active.length ? ' selected' : '')}>
      {facetLabels[field]} {active.length > 0 && <span className="mini-count">{active.length}</span>} <ChevronDown size={13} />
    </summary>
    <div className="popover facet-popover">
      <label className="input-with-icon"><Search size={15} /><input aria-label={'搜索' + facetLabels[field]} value={search}
        onChange={event => setSearch(event.target.value)} placeholder="筛选选项…" /></label>
      <div className="option-list">
        {choices.length === 0 && <p className="muted padded">暂无选项</p>}
        {choices.map(value => <label className="checkbox-option" key={value}>
          <input type="checkbox" checked={active.includes(value)} onChange={event => onChange(
            event.target.checked ? [...active, value] : active.filter(selected => selected !== value),
          )} />
          <span>{facetLabel(field, value)}</span>
        </label>)}
      </div>
      {active.length > 0 && <button type="button" className="link-button" onClick={() => onChange([])}>清除此项</button>}
    </div>
  </details>
}

function SortMenu({ query, onChange }: { query: Query; onChange: (settings: Partial<ViewSettings>) => void }) {
  const first = query.primary
  const second = query.secondary
  return <details className="dropdown align-right">
    <summary className="button outline small">{sortLabels[first.field]}{first.direction === 'asc' ? ' ↑' : ' ↓'} <ChevronDown size={13} /></summary>
    <div className="popover sort-popover">
      <strong>两级排序</strong>
      <div className="sort-row">
        <label>主排序<select aria-label="主排序字段" value={first.field} onChange={event => {
          const field = event.target.value as SortField
          onChange({ primary: { ...first, field }, secondary: second?.field === field ? null : second })
        }}>{sortFields.map(field => <option key={field} value={field}>{sortLabels[field]}</option>)}</select></label>
        <label>方向<select aria-label="主排序方向" value={first.direction} onChange={event =>
          onChange({ primary: { ...first, direction: event.target.value as 'asc' | 'desc' } })}>
          <option value="asc">升序</option><option value="desc">降序</option>
        </select></label>
      </div>
      <div className="sort-row">
        <label>次排序<select aria-label="次排序字段" value={second?.field ?? ''} onChange={event => onChange({
          secondary: event.target.value ? { field: event.target.value as SortField, direction: second?.direction ?? 'asc' } : null,
        })}><option value="">无</option>{sortFields.filter(field => field !== first.field).map(field =>
          <option key={field} value={field}>{sortLabels[field]}</option>,
        )}</select></label>
        <label>方向<select aria-label="次排序方向" value={second?.direction ?? 'asc'} disabled={!second}
          onChange={event => second && onChange({ secondary: { ...second, direction: event.target.value as 'asc' | 'desc' } })}>
          <option value="asc">升序</option><option value="desc">降序</option>
        </select></label>
      </div>
      <span className="muted">未填写的值排在最后</span>
    </div>
  </details>
}

function PresetMenu({ presets, onSave, onRemove, onSelect }: {
  presets: Preset[]; onSave: (name: string) => Promise<boolean>; onRemove: (name: string) => void; onSelect: (preset: Preset) => void
}) {
  const [name, setName] = useState('')
  return <details className="dropdown align-right">
    <summary className="button outline small"><Star size={15} /> 预设 <ChevronDown size={13} /></summary>
    <div className="popover preset-popover">
      <strong>我的筛选预设</strong>
      <div className="option-list">
        {presets.length === 0 && <p className="muted padded">保存当前筛选和排序，随时打开。</p>}
        {presets.map(preset => <div className="preset-row" key={preset.name}>
          <button className="link-button" onClick={() => onSelect(preset)}>{preset.name}</button>
          <button className="icon-button" aria-label={'删除预设 ' + preset.name} onClick={() => onRemove(preset.name)}><Trash2 size={14} /></button>
        </div>)}
      </div>
      <form className="inline-form" onSubmit={async event => {
        event.preventDefault()
        if (name.trim() && await onSave(name.trim())) setName('')
      }}>
        <input aria-label="预设名称" placeholder="预设名称" value={name} maxLength={60} onChange={event => setName(event.target.value)} />
        <button className="button primary small" disabled={!name.trim()}><Plus size={15} /> 保存</button>
      </form>
    </div>
  </details>
}

export function FilterBar({ query, view, presets, onChange, onSavePreset, onRemovePreset, onSelectPreset }: {
  query: Query; view: View | null; presets: Preset[]; onChange: (settings: Partial<ViewSettings>) => void
  onSavePreset: (name: string) => Promise<boolean>; onRemovePreset: (name: string) => void; onSelectPreset: (preset: Preset) => void
}) {
  const [advanced, setAdvanced] = useState(false)
  const filters = query.filters
  const change = (update: Partial<Filters>) => onChange({ filters: { ...filters, ...update } })
  const rangeFields: { key: RangeField; name: string; max: number; step: number }[] = [
    { key: 'minScore', name: '最低评分', max: 10, step: 0.5 },
    { key: 'maxScore', name: '最高评分', max: 10, step: 0.5 },
    { key: 'minAbv', name: '最低酒精度 %', max: 100, step: 0.1 },
    { key: 'maxAbv', name: '最高酒精度 %', max: 100, step: 0.1 },
  ]
  const chips = facetFields.flatMap(field => filters[field].map(value => ({
    key: field + value, name: facetLabel(field, value), clear: () => change({ [field]: filters[field].filter(item => item !== value) }),
  })))
  for (const field of Object.keys(options) as ToggleField[]) {
    if (filters[field] !== 'all') chips.push({
      key: field, name: (options[field] as Record<string, string>)[filters[field]], clear: () => change({ [field]: 'all' }),
    })
  }
  for (const { key, name } of rangeFields) {
    if (filters[key] !== null) chips.push({ key, name: name + ' ' + filters[key], clear: () => change({ [key]: null }) })
  }
  return <section className="filters" aria-label="筛选与排序">
    <div className="filter-row">
      <div className="facet-row">
        {facetFields.map(field => <FacetMenu key={field} field={field} values={view?.facets[field] ?? []}
          active={filters[field]} onChange={values => change({ [field]: values })} />)}
        <button className={'button outline small' + (advanced ? ' selected' : '')} onClick={() => setAdvanced(value => !value)}
          aria-expanded={advanced}><SlidersHorizontal size={15} /> 更多筛选</button>
      </div>
      <div className="facet-row sorting">
        {!query.group && <SortMenu query={query} onChange={onChange} />}
        <PresetMenu presets={presets} onSave={onSavePreset} onRemove={onRemovePreset} onSelect={onSelectPreset} />
      </div>
    </div>
    {advanced && <div className="advanced">
      {(Object.keys(options) as ToggleField[]).map((field, index) => <label key={field}>
        {['品饮状态', '资料完整度', '封面'][index]}
        <select value={filters[field]} onChange={event => change({ [field]: event.target.value })}>
          {Object.entries(options[field]).map(([value, name]) => <option value={value} key={value}>{name}</option>)}
        </select>
      </label>)}
      {rangeFields.map(({ key, name, max, step }) => <label key={key}>{name}
        <input type="number" min={0} max={max} step={step} placeholder="不限" value={filters[key] ?? ''}
          onChange={event => change({ [key]: event.target.value === '' ? null : Math.max(0, Math.min(max, Number(event.target.value))) })} />
      </label>)}
    </div>}
    {(chips.length > 0 || filters.search) && <div className="chip-row">
      {chips.map(({ key, name, clear }) => <button key={key} className="chip removable" onClick={clear} aria-label={'移除筛选 ' + name}>
        <Check size={12} />{name}<X size={13} />
      </button>)}
      <button className="link-button" onClick={() => onChange({ filters: { ...emptyFilters } })}>清空条件</button>
    </div>}
  </section>
}
