import { app, BrowserWindow, dialog, ipcMain, nativeImage, protocol, session, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, renameSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { backup as sqliteBackup } from 'node:sqlite'
import type { Draft, Entry, Preset, View } from '../shared/model.ts'
import { cleanQuery, makeCsv, makeGroupCsv, queryEntries } from '../shared/query.ts'
import { CatalogStore, LibraryStore, lcboUrl, mergeEntries, sameBeer, validId, type Photo } from './store.ts'

const origin = 'beerranking://app'
const rendererRoot = resolve(__dirname, '../renderer')
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'beerranking', privileges: { secure: true, standard: true, supportFetchAPI: true },
}])
const testData = process.env.BEERRANKING_TEST_DATA
if (testData) app.setPath('userData', resolve(testData))

let window: BrowserWindow | null = null
let catalog: CatalogStore
let library: LibraryStore
let installedCatalog: string
let bundledCatalog: string
let libraryPath: string
let entries: Entry[] | null = null
let pendingPhoto: { token: string; photo: Photo } | null = null
let catalogUpdateInProgress = false

function getEntries(): Entry[] {
  return entries ??= mergeEntries(catalog.entries, library.all())
}

function getView(input: unknown): View {
  const query = cleanQuery(input)
  const all = getEntries()
  const { rows, sorted, page, pageCount, facets, groups } = catalogueQuery(query, all)
  return {
    rows, total: sorted.length, page, pageCount, facets, groups, catalog: catalog.info,
    libraryCount: all.filter(entry => entry.record).length,
    tastedCount: all.filter(entry => entry.record?.tasted).length,
    scoredCount: all.filter(entry => entry.record?.score != null).length,
  }
}

function catalogueQuery(query: ReturnType<typeof cleanQuery>, all = getEntries()) {
  const scope = query.mode === 'discover' ? all.filter(entry => catalog.entries.has(entry.id)) : all
  return queryEntries(scope, query)
}

function assertId(value: unknown): string {
  if (typeof value !== 'string' || !validId.test(value)) throw new Error('酒款编号无效。')
  return value
}

function samePath(first: string, second: string): boolean {
  return resolve(first).toLowerCase() === resolve(second).toLowerCase()
}

async function atomicOutput(path: string, create: (temporary: string) => Promise<unknown>) {
  if ([libraryPath, installedCatalog, bundledCatalog].some(owned => samePath(path, owned))) {
    throw new Error('请选择不同的文件名，应用正在使用此文件。')
  }
  const temporary = join(dirname(path), '.beer-ranking-' + randomUUID() + '.tmp')
  try {
    await create(temporary)
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

function attachedWindow(): BrowserWindow {
  if (!window) throw new Error('应用窗口已关闭。')
  return window
}

function resized(image: Electron.NativeImage, maximum: number) {
  const { width, height } = image.getSize()
  const factor = Math.min(1, maximum / Math.max(width, height))
  return factor === 1 ? image : image.resize({
    width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)), quality: 'best',
  })
}

async function pickPhoto() {
  const result = await dialog.showOpenDialog(attachedWindow(), {
    title: '选择个人封面', properties: ['openFile'], filters: [{ name: '照片', extensions: ['jpg', 'jpeg', 'png'] }],
  })
  if (result.canceled) return null
  const path = result.filePaths[0]
  if ((await stat(path)).size > 20 * 1024 * 1024) throw new Error('照片须小于 20 MB。')
  const bytes = await readFile(path)
  const jpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const image = jpeg || png ? nativeImage.createFromBuffer(bytes) : null
  if (!image || image.isEmpty()) throw new Error('无法打开此照片。请选择有效的 JPG 或 PNG。')
  const photo: Photo = { cover: resized(image, 1600).toJPEG(87), thumb: resized(image, 380).toJPEG(84) }
  const token = randomUUID()
  pendingPhoto = { token, photo }
  return { token, preview: 'data:image/jpeg;base64,' + Buffer.from(photo.thumb).toString('base64') }
}

async function updateCatalog() {
  if (catalogUpdateInProgress) throw new Error('目录正在更新。')
  catalogUpdateInProgress = true
  const temporary = join(dirname(installedCatalog), 'catalog-' + randomUUID() + '.tmp')
  try {
    const result = await dialog.showOpenDialog(attachedWindow(), {
      title: '选择 BeerRanking 目录数据包', properties: ['openFile'],
      filters: [{ name: '目录数据包', extensions: ['sqlite'] }],
    })
    if (result.canceled) return null
    const source = result.filePaths[0]
    if (samePath(source, installedCatalog)) return catalog.info
    await copyFile(source, temporary)
    const candidate = new CatalogStore(temporary, true)
    const info = candidate.info
    candidate.close()
    const resultDialog = await dialog.showMessageBox(attachedWindow(), {
      type: 'question', buttons: ['更新目录', '取消'], defaultId: 0, cancelId: 1,
      title: '更新公开目录', message: `加载 ${info.count.toLocaleString('zh-CN')} 款啤酒？`,
      detail: '你的酒单、评分、短评和个人照片会继续保留。',
    })
    if (resultDialog.response !== 0) return null
    catalog.close()
    try {
      renameSync(temporary, installedCatalog)
    } finally {
      catalog = new CatalogStore(existsSync(installedCatalog) ? installedCatalog : bundledCatalog)
      entries = null
    }
    library.relink(catalog.entries)
    return catalog.info
  } finally {
    await rm(temporary, { force: true })
    catalogUpdateInProgress = false
  }
}

function handle(channel: string, operation: (...args: unknown[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    if (event.sender !== window?.webContents || event.senderFrame?.url !== origin + '/') {
      throw new Error('此请求无权访问本地数据。')
    }
    return operation(...args)
  })
}

function registerIpc() {
  handle('view', getView)
  handle('entry', value => getEntries().find(entry => entry.id === assertId(value)) ?? null)
  handle('pick-photo', pickPhoto)
  handle('save', value => {
    if (!value || typeof value !== 'object') throw new Error('记录格式无效。')
    const draft = value as Draft
    const id = draft.id === null ? null : assertId(draft.id)
    if ((!id || id.startsWith('personal-')) && typeof draft.name === 'string' && typeof draft.brand === 'string'
      && getEntries().some(entry => entry.id !== id && sameBeer(entry, draft.name, draft.brand)
        && (entry.abv === null || draft.abv === null || Math.abs(entry.abv - draft.abv) <= 0.15))) {
      throw new Error('此品牌下已有同名啤酒。请在图鉴搜索并打开该条目。')
    }
    const staged = pendingPhoto
    const photo = staged && draft.photo?.action === 'replace' && staged.token === draft.photo.token ? staged.photo : undefined
    const saved = library.save(draft, id ? catalog.entries.get(id) ?? null : null, photo)
    entries = null
    if (photo) pendingPhoto = null
    return saved
  })
  handle('remove', value => {
    library.remove(assertId(value))
    entries = null
  })
  handle('presets', () => library.presets())
  handle('save-preset', value => library.savePreset(value as Preset))
  handle('remove-preset', value => library.removePreset(String(value)))
  handle('open-source', async value => {
    if (typeof value !== 'string' || value.length > 1000) throw new Error('来源链接无效。')
    const url = lcboUrl(value)
    if (!url) throw new Error('请选择 LCBO 官网来源链接。')
    await shell.openExternal(url.href)
  })
  handle('export-csv', async input => {
    const query = cleanQuery(input)
    const { sorted, groups } = catalogueQuery(query)
    const save = await dialog.showSaveDialog(attachedWindow(), {
      title: '导出当前筛选结果', defaultPath: 'BeerRanking.csv', filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (save.canceled || !save.filePath) return false
    const content = query.group ? makeGroupCsv(groups, query.group) : makeCsv(sorted)
    await atomicOutput(save.filePath, path => writeFile(path, content, { encoding: 'utf8', flag: 'wx' }))
    return true
  })
  handle('backup', async () => {
    const save = await dialog.showSaveDialog(attachedWindow(), {
      title: '备份我的酒单', defaultPath: 'BeerRanking-Backup-' + new Date().toISOString().slice(0, 10) + '.sqlite',
      filters: [{ name: 'BeerRanking 备份', extensions: ['sqlite'] }],
    })
    if (save.canceled || !save.filePath) return false
    await atomicOutput(save.filePath, path => sqliteBackup(library.db, path))
    return true
  })
  handle('restore', async () => {
    const selection = await dialog.showOpenDialog(attachedWindow(), {
      title: '恢复我的酒单', properties: ['openFile'], filters: [{ name: 'BeerRanking 备份', extensions: ['sqlite'] }],
    })
    if (selection.canceled) return false
    const source = selection.filePaths[0]
    if (samePath(source, libraryPath)) throw new Error('请选择独立的备份文件。')
    const restored = library.restore(source, () => {
      const decision = dialog.showMessageBoxSync(attachedWindow(), {
        type: 'warning', buttons: ['备份当前酒单并恢复', '取消'], defaultId: 1, cancelId: 1,
        title: '恢复品饮记录', message: '用备份替换当前的个人记录和筛选预设？',
        detail: '当前酒单将先备份到应用数据目录。',
      })
      if (decision !== 0) return false
      const path = join(dirname(libraryPath), 'before-restore-' + Date.now() + '.sqlite')
      library.db.prepare('VACUUM INTO ?').run(path)
      return true
    })
    if (restored) {
      entries = null
      pendingPhoto = null
      library.relink(catalog.entries)
    }
    return restored
  })
  handle('update-catalog', updateCatalog)
}

async function serve(request: Request): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 405 })
  const url = new URL(request.url)
  if (url.hostname !== 'app') return new Response(null, { status: 404 })
  const path = decodeURIComponent(url.pathname)
  const match = /^\/covers\/(public|personal)\/(thumb|full)\/([a-z0-9-]+)$/.exec(path)
  if (match) {
    const [, type, size, id] = match
    const bytes = type === 'public' ? catalog.photo(id, size === 'thumb') : library.photo(id, size === 'thumb')
    return bytes
      ? new Response(Buffer.from(bytes), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } })
      : new Response(null, { status: 404 })
  }
  const file = resolve(rendererRoot, '.' + (path === '/' ? '/index.html' : path))
  const type = mime[extname(file)]
  if (!type || relative(rendererRoot, file).startsWith('..')) return new Response(null, { status: 404 })
  try {
    return new Response(await readFile(file), { headers: { 'Content-Type': type } })
  } catch {
    return new Response(null, { status: 404 })
  }
}

async function start() {
  const data = app.getPath('userData')
  await mkdir(data, { recursive: true })
  installedCatalog = join(data, 'lcbo-catalog.sqlite')
  bundledCatalog = app.isPackaged ? join(process.resourcesPath, 'beer-catalog.sqlite') : join(app.getAppPath(), 'catalog', 'beer-catalog.sqlite')
  libraryPath = join(data, 'library.sqlite')
  catalog = new CatalogStore(existsSync(installedCatalog) ? installedCatalog : bundledCatalog)
  library = new LibraryStore(libraryPath)
  library.relink(catalog.entries)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  protocol.handle('beerranking', serve)
  registerIpc()
  window = new BrowserWindow({
    width: 1370, height: 900, minWidth: 920, minHeight: 650, show: false,
    title: 'BeerRanking · LCBO 啤酒图鉴', autoHideMenuBar: true, backgroundColor: '#f6f6f1',
    icon: app.isPackaged ? undefined : join(app.getAppPath(), 'assets', 'beer.ico'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (url !== origin + '/') event.preventDefault() })
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => { window = null })
  await window.loadURL(origin + '/')
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app.on('window-all-closed', () => app.quit())
  app.whenReady().then(start).catch(error => {
    dialog.showErrorBox('BeerRanking 启动失败', String(error))
    app.exit(1)
  })
}
