import { Beer as BeerIcon, Bookmark, Calendar, Camera, Check, ExternalLink, ImagePlus, MapPin, Pencil, Star, Trash2, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { regions, type Draft, type Entry } from '../shared/model.ts'

export function imageUrl(id: string, kind: 'public' | 'personal', full = false) {
  return '/covers/' + kind + '/' + (full ? 'full/' : 'thumb/') + id
}

export function ProductImage({ entry, personal = false, full = false }: { entry: Entry; personal?: boolean; full?: boolean }) {
  const [failed, setFailed] = useState(false)
  const image = personal ? entry.record?.hasPhoto : entry.hasPhoto
  if (image && !failed) return <img src={imageUrl(entry.id, personal ? 'personal' : 'public', full)} alt={entry.name}
    loading={full ? 'eager' : 'lazy'} onError={() => setFailed(true)} />
  return <div className={'beer-placeholder tone-' + (entry.name.codePointAt(0) ?? 0) % 5} aria-label="暂无图片">
    <BeerIcon size={full ? 55 : 38} strokeWidth={1.25} />
    {full && <span>暂无产品照</span>}
  </div>
}

export function Score({ value }: { value: number }) {
  return <span className="score-badge"><Star size={13} fill="currentColor" />{value.toFixed(1)}<small>/ 10</small></span>
}

export function BeerCard({ entry, open, preferPersonal, rank }: {
  entry: Entry; open: () => void; preferPersonal: boolean; rank?: number
}) {
  const personal = Boolean((preferPersonal || !entry.hasPhoto) && entry.record?.hasPhoto)
  return <button className="beer-card" onClick={open} aria-label={'查看 ' + entry.name}>
    <div className="card-image">
      <ProductImage key={entry.id + personal} entry={entry} personal={personal} />
      {rank !== undefined && <span className="rank-number">#{rank}</span>}
      {entry.record?.score != null ? <div className="card-badge"><Score value={entry.record.score} /></div>
        : entry.record && <span className="card-badge card-state">{entry.record.tasted ? '已喝' : '待尝'}</span>}
    </div>
    <div className="card-body">
      <div className="card-brand">{entry.brand || '品牌待补充'}</div>
      <h3 title={entry.name}>{entry.name}</h3>
      <div className="card-meta"><span>{entry.style || '风格待补充'}</span>
        {entry.abv !== null && <span>{entry.abv}%</span>}</div>
    </div>
  </button>
}

export function Modal({ children, close, label, wide = false, error, clearError }: {
  children: ReactNode; close: () => void; label: string; wide?: boolean; error?: string; clearError?: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog?.open) dialog?.showModal()
  }, [])
  return <dialog className={'modal' + (wide ? ' wide' : '')} ref={ref} aria-label={label}
    onCancel={event => { event.preventDefault(); close() }}
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="modal-content">
      <button type="button" className="icon-button modal-close" aria-label="关闭" onClick={close}><X size={21} /></button>
      {error && <div className="inline-error" role="alert">
        <span>{error}</span><button className="icon-button" aria-label="关闭通知" onClick={clearError}><X size={16} /></button>
      </div>}
      {children}
    </div>
  </dialog>
}

export function BeerDetail({ entry, onEdit, onDelete, openSource }: {
  entry: Entry; onEdit: () => void; onDelete: () => void; openSource: (url: string) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const record = entry.record
  return <div className="detail">
    <div className="detail-photo">
      <div className="detail-image"><ProductImage entry={entry} full /></div>
      <p className="photo-caption"><Camera size={14} /> {entry.hasPhoto ? '产品包装照' : '包装照待补充'}</p>
      {entry.photoCredit && <div className="photo-credit">
        <button className="link-button" onClick={() => openSource(entry.photoCredit!.url)}>{entry.photoCredit.label}</button>
        <button className="link-button" onClick={() => openSource(entry.photoCredit!.licenseUrl)}>{entry.photoCredit.license}</button>
      </div>}
    </div>
    <div className="detail-main">
      <div className="eyebrow">{entry.brand || '品牌待补充'}</div>
      <h2>{entry.name}</h2>
      <div className="chip-row">
        {entry.style && <span className="chip">{entry.style}</span>}
        {entry.abv !== null && <span className="chip">{entry.abv}% ABV</span>}
        {entry.origin && <span className="chip"><MapPin size={13} />{entry.origin}</span>}
      </div>
      {entry.brewery && entry.brewery !== entry.brand && <p className="muted">酒厂记录 · {entry.brewery}</p>}
      {entry.retailStyle && entry.retailStyle !== entry.style && <p className="muted">LCBO 风味风格 · {entry.retailStyle}</p>}
      {entry.lcboSkus?.length ? <p className="muted">LCBO 商品编号 · {entry.lcboSkus.join('、')}</p> : null}
      {entry.marketRegions.length > 0 && <p className="muted">目录地区 · {entry.marketRegions.map(code => regions[code] ?? code).join('、')}</p>}
      <section className="detail-section">
        <h3>口味资料</h3>
        {entry.flavors.length > 0 && <div className="chip-row">{entry.flavors.map(flavor => <span className="chip flavor" key={flavor}>{flavor}</span>)}</div>}
        <p className={entry.tastingNotes ? '' : 'muted'}>{entry.tastingNotes || '暂无逐款口味资料'}</p>
      </section>
      <section className="detail-section">
        <div className="detail-section-header"><h3>我的品饮</h3>{record?.score != null && <Score value={record.score} />}</div>
        {record ? <>
          <div className="record-line"><span className="chip">{record.tasted ? '已喝' : '待尝'}</span>
            {record.date && <span className="muted icon-text"><Calendar size={14} />{record.date}</span>}</div>
          {record.review && <p className="review">{record.review}</p>}
          {record.hasPhoto && <div className="personal-detail"><ProductImage entry={entry} personal full /><span className="muted">个人封面</span></div>}
        </> : <p className="muted">加入酒单，记录你的评分、短评和照片。</p>}
        <div className="detail-actions">
          <button className="button primary" onClick={onEdit}>{record ? <Pencil size={16} /> : <Bookmark size={16} />}
            {record ? '编辑品饮记录' : '加入我的酒单'}</button>
          {record && <button className="button subtle danger" onClick={() => setConfirmDelete(value => !value)}><Trash2 size={15} />移除</button>}
        </div>
        {confirmDelete && <div className="delete-confirm">
          <span>移除此酒的个人记录、评分和封面？</span>
          <button className="button danger outline small" onClick={onDelete}>确认移除</button>
        </div>}
      </section>
      {entry.sources.length > 0 && <section className="detail-section">
        <h3>资料来源</h3>
        <div className="source-list">{entry.sources.map(source => <button className="source-link" key={source.url}
          onClick={() => openSource(source.url)}><ExternalLink size={14} />
          {source.label}{entry.sources.length > 1 && ' · ' + source.url.split('-').at(-1)}
          <small>{source.license}</small></button>)}</div>
      </section>}
    </div>
  </div>
}

function makeDraft(entry: Entry | null): Draft {
  return {
    id: entry?.id ?? null, name: entry?.name ?? '', brand: entry?.brand ?? '', style: entry?.style ?? '',
    origin: entry?.origin ?? '', abv: entry?.abv ?? null, tasted: entry?.record?.tasted ?? false,
    score: entry?.record?.score ?? null, review: entry?.record?.review ?? '', date: entry?.record?.date ?? null,
    photo: { action: 'keep' },
  }
}

export function BeerForm({ entry, styles, close, onSave, onPhoto }: {
  entry: Entry | null; styles: string[]; close: () => void; onSave: (draft: Draft) => Promise<boolean>
  onPhoto: () => Promise<{ token: string; preview: string } | null>
}) {
  const [draft, setDraft] = useState(() => makeDraft(entry))
  const [preview, setPreview] = useState(entry?.record?.hasPhoto ? imageUrl(entry.id, 'personal') : null)
  const [pending, setPending] = useState(false)
  const editable = !entry || entry.id.startsWith('personal-')
  const set = <K extends keyof Draft,>(field: K, value: Draft[K]) => setDraft(state => ({ ...state, [field]: value }))
  return <form className="beer-form" onSubmit={async event => {
    event.preventDefault()
    setPending(true)
    try {
      await onSave(draft)
    } finally {
      setPending(false)
    }
  }}>
    <div className="eyebrow">MY TASTING JOURNAL</div>
    <h2>{entry ? entry.record ? '编辑品饮记录' : '加入我的酒单' : '添加一款啤酒'}</h2>
    {editable ? <div className="form-grid">
      <label>酒名<input required maxLength={160} value={draft.name} onChange={event => set('name', event.target.value)} /></label>
      <label>品牌 / 酒厂<input required maxLength={160} value={draft.brand} onChange={event => set('brand', event.target.value)} /></label>
      <label>风格<input list="beer-styles" maxLength={100} value={draft.style} onChange={event => set('style', event.target.value)} />
        <datalist id="beer-styles">{styles.map(style => <option key={style} value={style} />)}</datalist></label>
      <label>产地<input maxLength={100} placeholder="如 加拿大 · 魁北克" value={draft.origin} onChange={event => set('origin', event.target.value)} /></label>
      <label>酒精度 %<input type="number" min={0} max={100} step={0.01} value={draft.abv ?? ''}
        onChange={event => set('abv', event.target.value === '' ? null : Number(event.target.value))} /></label>
    </div> : <p className="record-title">{entry.name} <span className="muted">{entry.brand}</span></p>}
    <label className="tasted-control"><input type="checkbox" checked={draft.tasted} onChange={event => set('tasted', event.target.checked)} />
      <span>{draft.tasted ? <Check size={17} /> : <Bookmark size={17} />}{draft.tasted ? '我喝过这款酒' : '标记为已喝'}</span></label>
    {draft.tasted && <div className="form-grid">
      <label>评分（10 分制）<select value={draft.score ?? ''} onChange={event => set('score', event.target.value === '' ? null : Number(event.target.value))}>
        <option value="">未评分</option>{Array.from({ length: 21 }, (_, index) => index / 2).map(score =>
          <option key={score} value={score}>{score.toFixed(1)}</option>,
        )}</select></label>
      <label>品饮日期<input type="date" value={draft.date ?? ''} onChange={event => set('date', event.target.value || null)} /></label>
      <label className="span-two">我的短评<textarea maxLength={1000} rows={3} value={draft.review}
        placeholder="记下香气、口感，或这款酒最让你记住的地方。" onChange={event => set('review', event.target.value)} /></label>
    </div>}
    <div className="photo-field">
      <div className="draft-photo">{preview ? <img src={preview} alt="个人封面预览" /> : <Camera size={23} />}</div>
      <div><strong>个人封面</strong><p className="muted">JPG 或 PNG · 最大 20 MB</p>
        <div className="detail-actions">
          <button className="button outline small" type="button" onClick={async () => {
            const photo = await onPhoto()
            if (photo) { setPreview(photo.preview); set('photo', { action: 'replace', token: photo.token }) }
          }}><ImagePlus size={15} />{preview ? '替换照片' : '选择照片'}</button>
          {preview && <button className="button subtle small" type="button" onClick={() => {
            setPreview(null); set('photo', { action: 'remove' })
          }}>移除照片</button>}
        </div>
      </div>
    </div>
    <div className="form-footer">
      <button type="button" className="button outline" onClick={close} disabled={pending}>取消</button>
      <button className="button primary" disabled={pending}>{pending ? '保存中…' : '保存记录'}</button>
    </div>
  </form>
}
