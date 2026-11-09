import {
  ArrowDownToLine, ArrowRight, Beer, Bookmark, ChevronLeft, ChevronRight, Database, FolderUp, HardDrive,
  Image as ImageIcon, Layers3, Library, Plus, Search, Sparkles, Trophy, X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { emptyFilters, pageSize, type Draft, type Entry, type Facet, type GroupField, type Mode, type Preset, type Query, type View, type ViewSettings } from '../shared/model.ts'
import { BeerCard, BeerDetail, BeerForm, Modal } from './beer.tsx'
import { FilterBar } from './filters.tsx'

const api = window.beerRanking
const number = new Intl.NumberFormat('zh-CN')
const modes = [
  { id: 'discover', title: '发现图鉴', icon: Library },
  { id: 'library', title: '我的酒单', icon: Bookmark },
  { id: 'ranking', title: '评分排行', icon: Trophy },
] as const
const groupNames: Record<GroupField, string> = { brand: '品牌', style: '风格', origin: '产地' }

function defaultSort(mode: Mode): Pick<Query, 'primary' | 'secondary'> {
  return mode === 'ranking'
    ? { primary: { field: 'score', direction: 'desc' }, secondary: { field: 'date', direction: 'desc' } }
    : { primary: { field: 'name', direction: 'asc' }, secondary: null }
}

function HeroArt() {
  return <svg className="hero-art" viewBox="0 0 400 240" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="can-shine" x1="148" x2="283" y1="120" y2="180" gradientUnits="userSpaceOnUse">
        <stop stopColor="#e7ae69" /><stop offset=".46" stopColor="#f7d196" /><stop offset="1" stopColor="#b97339" />
      </linearGradient>
      <linearGradient id="can-label" x1="147" x2="271" y1="101" y2="180" gradientUnits="userSpaceOnUse">
        <stop stopColor="#274c40" /><stop offset=".5" stopColor="#426858" /><stop offset="1" stopColor="#224137" />
      </linearGradient>
    </defs>
    <circle cx="218" cy="114" r="94" fill="#f1c585" opacity=".18" />
    <circle cx="218" cy="114" r="105" stroke="#a8c6aa" opacity=".25" />
    <circle cx="218" cy="114" r="124" stroke="#a8c6aa" opacity=".12" />
    <path d="M41 184c49-62 126-88 190-73 40 9 76 13 127-20M39 198c51-57 119-75 178-66 42 6 90 15 144-12"
      stroke="#a2bca0" strokeWidth="1.2" opacity=".32" />
    <g transform="rotate(13 217 117)">
      <path d="M163 50q1-12 12-17h88q10 5 11 17v144q0 15-16 17h-79q-16-2-16-17V50Z" fill="url(#can-shine)" />
      <path d="M163 65q55 10 111 0v109q-55 10-111 0V65Z" fill="url(#can-label)" />
      <path d="M171 197q47 10 95 0l-7 12h-80l-8-12Z" fill="#ba814d" />
      <ellipse cx="218.5" cy="34" rx="45" ry="8.5" fill="#e4ccaa" /><ellipse cx="218.5" cy="34" rx="34" ry="5.4" stroke="#8e7a59" />
      <path d="M217 31h11l-3 5h-13z" fill="#a48b68" />
      <path d="M217 96v-9m0 26c-7-13-14-11-16-7 3 7 10 10 16 7Zm0 0c7-13 14-11 16-7-3 7-10 10-16 7Zm0 12c-8-12-16-12-17-6 3 7 10 10 17 6Zm0 0c8-12 16-12 17-6-3 7-10 10-17 6Zm0-29c-5-5-6-10 0-13 6 3 5 8 0 13Z"
        stroke="#e9c98d" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M184 140h69M190 158h57" stroke="#d9bb81" strokeWidth=".7" opacity=".75" />
      <text x="218" y="152" fill="#f9e6bc" textAnchor="middle" fontSize="9" fontFamily="Georgia" letterSpacing="2">BEER ATLAS</text>
    </g>
    <path d="M316 156l4 9 9 4-9 4-4 9-4-9-9-4 9-4 4-9ZM110 48l3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" fill="#dfbb7e" opacity=".8" />
    <circle cx="339" cy="107" r="3" fill="#debf83" /><circle cx="126" cy="182" r="2" fill="#debf83" />
  </svg>
}

function Hero({ mode, view, showPhotos }: { mode: Mode; view: View | null; showPhotos: () => void }) {
  if (mode !== 'discover') {
    return <section className="page-intro">
      <span className="eyebrow">{mode === 'library' ? 'MY TASTING JOURNAL' : 'PERSONAL RANKINGS'}</span>
      <h1>{mode === 'library' ? '我的酒单' : '评分排行'}</h1>
      <p>{mode === 'library' ? '把想喝的酒收藏起来，留下每次品饮的记忆。' : '找出最喜欢的啤酒，按品牌、风格或产地比较评分。'}</p>
      <div className="personal-stats">
        <span><Bookmark size={16} />{number.format(view?.libraryCount ?? 0)} 款收藏</span>
        <span><Beer size={16} />{number.format(view?.tastedCount ?? 0)} 款已喝</span>
        <span><Trophy size={16} />{number.format(view?.scoredCount ?? 0)} 款已评分</span>
      </div>
    </section>
  }
  return <section className="hero">
    <div className="hero-copy">
      <span className="hero-eyebrow"><span /> LCBO BEER CATALOGUE</span>
      <h1>下一款，想喝什么？</h1>
      <p>浏览 LCBO 官网收录的啤酒，按品牌、风格和口味筛选。遇到喜欢的，就收进自己的酒单。</p>
      <div className="hero-stats">
        <span><Layers3 size={16} /><strong>{view ? number.format(view.catalog.count) : '…'}</strong> 独立酒款</span>
        <button onClick={showPhotos}><ImageIcon size={16} /><strong>{view ? number.format(view.catalog.withPhoto) : '…'}</strong> 款有图 <ArrowRight size={15} /></button>
      </div>
    </div>
    <HeroArt />
  </section>
}

function formatError(error: unknown) {
  return String(error).replace(/^Error: Error invoking remote method '[^']+': (?:Error: )?/, '').replace(/^Error: /, '')
}

export function App() {
  const [query, setQuery] = useState<Query>({
    mode: 'discover', filters: { ...emptyFilters }, ...defaultSort('discover'), page: 1, group: null,
  })
  const [view, setView] = useState<View | null>(null)
  const [presets, setPresets] = useState<Preset[]>([])
  const [revision, setRevision] = useState(0)
  const [detail, setDetail] = useState<Entry | null>(null)
  const [editor, setEditor] = useState<{ entry: Entry | null } | null>(null)
  const [about, setAbout] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let current = true
    const timer = setTimeout(() => {
      api.view(query).then(next => { if (current) setView(next) }).catch(error => {
        if (current) setNotice({ text: formatError(error), error: true })
      })
    }, query.filters.search ? 95 : 0)
    return () => { current = false; clearTimeout(timer) }
  }, [query, revision])

  useEffect(() => {
    api.presets().then(setPresets).catch(error => setNotice({ text: formatError(error), error: true }))
  }, [])
  useEffect(() => {
    if (!notice || notice.error) return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  function change(settings: Partial<ViewSettings>) {
    setQuery(previous => ({ ...previous, ...settings, page: 1 }))
  }

  function switchMode(mode: Mode) {
    if (mode === query.mode) return
    setQuery(previous => ({ ...previous, ...defaultSort(mode), mode, group: null, page: 1 }))
    document.querySelector('main')?.scrollTo(0, 0)
  }

  function refresh() {
    setRevision(value => value + 1)
  }

  async function attempt<T>(action: () => Promise<T>): Promise<T | null> {
    try {
      return await action()
    } catch (error) {
      setNotice({ text: formatError(error), error: true })
      return null
    }
  }

  async function openEntry(id: string) {
    const entry = await attempt(() => api.entry(id))
    if (entry) setDetail(entry)
  }

  async function save(draft: Draft): Promise<boolean> {
    const id = await attempt(() => api.save(draft))
    if (!id) return false
    setEditor(null)
    refresh()
    await openEntry(id)
    setNotice({ text: '已保存到我的酒单' })
    return true
  }

  async function runData(action: 'export' | 'backup' | 'restore' | 'update') {
    setBusy(true)
    try {
      const result = await attempt<unknown>(() => ({
        export: () => api.exportCsv(query), backup: () => api.backup(),
        restore: () => api.restore(), update: () => api.updateCatalog(),
      }[action]()))
      if (!result) return
      if (action === 'restore') {
        const restoredPresets = await attempt(() => api.presets())
        if (restoredPresets) setPresets(restoredPresets)
      }
      refresh()
      setNotice({ text: { export: '已导出筛选结果', backup: '已保存个人备份', restore: '已恢复个人酒单', update: '已更新图鉴目录' }[action] })
    } finally {
      setBusy(false)
    }
  }

  const group = query.group
  const dialogError = notice?.error ? notice.text : undefined
  const selectedMode = modes.find(mode => mode.id === query.mode)!
  return <div className="shell">
    <aside className="sidebar">
      <div className="identity">
        <div className="logo"><Beer size={24} strokeWidth={1.7} /></div>
        <div><strong>BeerRanking</strong><span>LCBO 啤酒图鉴</span></div>
      </div>
      <span className="nav-label">我的空间</span>
      <nav aria-label="主要导航">{modes.map(({ id, title, icon: Icon }) =>
        <button className={'nav-button' + (id === query.mode ? ' active' : '')} key={id} onClick={() => switchMode(id)}
          aria-current={id === query.mode ? 'page' : undefined}>
          <Icon size={18} />{title}{id === 'library' && Boolean(view?.libraryCount) && <span>{view?.libraryCount}</span>}
        </button>,
      )}</nav>
      <div className="sidebar-footer">
        <button className="catalog-meta" onClick={() => setAbout(true)}>
          <span className="icon-text"><HardDrive size={16} /> LCBO 离线图鉴</span>
          <span className="catalog-sub">{view?.catalog.version ?? '正在读取目录'}</span>
          <span className="catalog-action">覆盖与来源 <ArrowRight size={13} /></span>
        </button>
        <div className="offline-status"><span /> 离线可用</div>
      </div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="breadcrumb"><selectedMode.icon size={16} />{selectedMode.title}</div>
        <label className="top-search"><Search size={18} /><input aria-label="搜索啤酒" placeholder="搜索酒名、品牌、风格或短评…"
          value={query.filters.search} onChange={event => change({ filters: { ...query.filters, search: event.target.value } })} />
          {query.filters.search && <button aria-label="清除搜索" className="icon-button" onClick={() =>
            change({ filters: { ...query.filters, search: '' } })}><X size={16} /></button>}
        </label>
        <div className="top-actions">
          <details className="dropdown align-right data-menu">
            <summary className="button outline"><Database size={16} /><span>数据</span></summary>
            <div className="popover menu-popover">
              <button disabled={busy} onClick={() => runData('export')}><ArrowDownToLine size={16} />导出当前结果</button>
              <button disabled={busy} onClick={() => runData('backup')}><HardDrive size={16} />备份个人记录</button>
              <button disabled={busy} onClick={() => runData('restore')}><FolderUp size={16} />恢复个人备份</button>
              <button disabled={busy} onClick={() => runData('update')}><Database size={16} />加载离线目录包</button>
            </div>
          </details>
          <button className="button primary" onClick={() => { setDetail(null); setEditor({ entry: null }) }}><Plus size={18} /> 添加啤酒</button>
        </div>
      </header>
      <main>
        <div className="page">
          <Hero mode={query.mode} view={view} showPhotos={() => change({ filters: { ...query.filters, cover: 'has' } })} />
          {query.mode === 'ranking' && <div className="ranking-tabs" aria-label="排行榜分组">
            <button className={!group ? 'active' : ''} onClick={() => setQuery(value => ({ ...value, group: null, page: 1 }))}>单品榜</button>
            {(Object.keys(groupNames) as GroupField[]).map(field => <button className={field === group ? 'active' : ''} key={field}
              onClick={() => setQuery(value => ({ ...value, group: field, page: 1 }))}>按{groupNames[field]}</button>)}
          </div>}
          <FilterBar query={query} view={view} presets={presets} onChange={change}
            onSavePreset={async name => {
              const result = await attempt(() => api.savePreset({ name, filters: query.filters, primary: query.primary, secondary: query.secondary }))
              if (!result) return false
              setPresets(result)
              setNotice({ text: '已保存筛选预设' })
              return true
            }}
            onRemovePreset={name => void attempt(() => api.removePreset(name)).then(result => result && setPresets(result))}
            onSelectPreset={({ filters, primary, secondary }) => change({ filters, primary, secondary })} />
          <div className="results-header">
            <h2>{query.mode === 'ranking' ? (group ? groupNames[group] + '排行' : '单品榜') : query.mode === 'library' ? '收藏的啤酒' : '浏览啤酒'}</h2>
            <span aria-live="polite">{view ? number.format(view.total) + ' 款匹配' : '正在读取…'}</span>
          </div>
          {view && group && view.groups.length > 0 ? <div className="group-table">
            <table>
              <thead><tr><th>{groupNames[group]}</th><th>匹配酒款</th><th>已评分</th><th>平均分 / 10</th><th><span className="sr-only">查看酒款</span></th></tr></thead>
              <tbody>{view.groups.map(row => <tr key={row.label ?? 'missing'}>
                <th scope="row">{row.label ?? '资料待补充'}</th><td>{row.count}</td><td>{row.scored}</td>
                <td className="average">{row.average?.toFixed(2) ?? '—'}</td>
                <td>{row.label && <button className="link-button icon-text" onClick={() => {
                  const field: Facet = { brand: 'brands', style: 'styles', origin: 'origins' }[group] as Facet
                  setQuery(value => ({ ...value, mode: 'library', group: null, page: 1, filters: { ...value.filters, [field]: [row.label] } }))
                }}>查看酒款 <ArrowRight size={14} /></button>}</td>
              </tr>)}</tbody>
            </table>
          </div> : view && view.rows.length > 0 ? <>
            <div className="beer-grid">
              {view.rows.map((entry, index) => <BeerCard key={entry.id + ':' + revision} entry={entry} open={() => void openEntry(entry.id)}
                preferPersonal={query.mode !== 'discover'} rank={query.mode === 'ranking' ? (view.page - 1) * pageSize + index + 1 : undefined} />)}
            </div>
            {view.pageCount > 1 && <div className="pagination">
              <button className="button outline small" disabled={view.page <= 1} onClick={() => {
                setQuery(value => ({ ...value, page: view.page - 1 })); document.querySelector('.results-header')?.scrollIntoView({ block: 'start' })
              }}><ChevronLeft size={16} />上一页</button>
              <span>第 {view.page} / {view.pageCount} 页</span>
              <button className="button outline small" disabled={view.page >= view.pageCount} onClick={() => {
                setQuery(value => ({ ...value, page: view.page + 1 })); document.querySelector('.results-header')?.scrollIntoView({ block: 'start' })
              }}>下一页<ChevronRight size={16} /></button>
            </div>}
          </> : view ? <div className="empty">
            <Search size={29} /><h3>{query.mode === 'ranking' && !view.scoredCount ? '评分后生成你的排行榜' : '没有找到匹配的啤酒'}</h3>
            <p>{query.mode === 'library' && !view.libraryCount ? '可以从图鉴添加酒款，也可以新建一款。' : '试试清空筛选或换一个搜索词。'}</p>
            <button className="button outline" onClick={() => query.mode === 'library' && !view.libraryCount
              ? switchMode('discover') : change({ filters: { ...emptyFilters } })}>
              {query.mode === 'library' && !view.libraryCount ? '去发现图鉴' : '清空筛选'}
            </button>
          </div> : <div className="loading" aria-live="polite">正在加载本地图鉴…</div>}
        </div>
      </main>
    </div>
    {detail && !editor && <Modal key={detail.id} close={() => { setDetail(null); if (dialogError) setNotice(null) }}
      label="酒款详情" wide error={dialogError} clearError={() => setNotice(null)}>
      <BeerDetail entry={detail} onEdit={() => setEditor({ entry: detail })} openSource={url => { void attempt(() => api.openSource(url)) }}
        onDelete={async () => {
          if (!await attempt(async () => { await api.remove(detail.id); return true })) return
          setDetail(null)
          refresh()
          setNotice({ text: '已移除个人记录' })
        }} />
    </Modal>}
    {editor && <Modal close={() => { setEditor(null); if (dialogError) setNotice(null) }}
      label="品饮记录" error={dialogError} clearError={() => setNotice(null)}>
      <BeerForm entry={editor.entry} styles={view?.facets.styles ?? []} close={() => setEditor(null)} onSave={save} onPhoto={() => attempt(() => api.pickPhoto())} />
    </Modal>}
    {about && <Modal close={() => { setAbout(false); if (dialogError) setNotice(null) }}
      label="图鉴覆盖与来源" error={dialogError} clearError={() => setNotice(null)}>
      <div className="about">
        <span className="eyebrow"><Sparkles size={15} /> OPEN CATALOG</span><h2>图鉴覆盖与来源</h2>
        {view && <>
          <p className="muted">快照 {view.catalog.version} · LCBO 安大略零售目录</p>
          <dl className="coverage-grid">
            {[['独立酒款', view.catalog.count], ['有风格', view.catalog.withStyle], ['有包装照', view.catalog.withPhoto],
              ['有逐款口味', view.catalog.withFlavor], ['资料完整', view.catalog.complete]].map(([label, value]) =>
              <div key={label}><dt>{label}</dt><dd>{number.format(Number(value))}</dd></div>,
            )}
          </dl>
          <p>资料完整指同时具备品牌、风格、商品品鉴描述和包装照。不同包装的 LCBO 商品编号保留在酒款详情中。</p>
          <div className="source-list">{view.catalog.sources.map(source => <button className="source-link" key={source.url}
            onClick={() => { void attempt(() => api.openSource(source.url)) }}>{source.label}<small>{source.license}</small><ArrowRight size={14} /></button>)}</div>
        </>}
      </div>
    </Modal>}
    {notice && !(notice.error && (editor || detail || about)) && <div className={'toast' + (notice.error ? ' error' : '')} role={notice.error ? 'alert' : 'status'}>
      {notice.text}<button aria-label="关闭通知" className="icon-button" onClick={() => setNotice(null)}><X size={16} /></button>
    </div>}
  </div>
}
