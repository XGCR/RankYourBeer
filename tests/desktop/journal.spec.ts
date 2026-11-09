import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { CatalogStore } from '../../src/main/store.ts'

const root = resolve('.')
const work = join(root, '.tools')
const bundle = join(root, 'catalog', 'beer-catalog.sqlite')
const executablePath = process.env.BEERRANKING_PACKAGED_EXE

async function chooseFile(app: ElectronApplication, path: string) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, path)
}

async function saveFile(app: ElectronApplication, path: string) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, path)
}

test('offline catalogue, personal journal, presets, CSV, restore and catalogue update', async () => {
  mkdirSync(join(work, 'qa'), { recursive: true })
  const data = mkdtempSync(join(work, 'desktop-test-'))
  const original = new CatalogStore(bundle)
  const item = [...original.entries.values()].find(entry => entry.lcboSkus?.includes('33989'))!
  expect(item.hasPhoto).toBe(true)
  const itemButton = { name: '查看 ' + item.name, exact: true }
  const imagePath = join(data, 'personal-test.jpg')
  writeFileSync(imagePath, original.photo(item.id, false)!)
  const invalid = join(data, 'invalid.png')
  writeFileSync(invalid, 'invalid image')
  writeFileSync(join(data, 'catalog.sqlite'), 'legacy catalogue')
  const updated = join(data, 'updated.sqlite')
  copyFileSync(bundle, updated)
  const update = new DatabaseSync(updated)
  update.prepare('UPDATE beers SET body = ? WHERE id = ?').run(
    JSON.stringify({ ...item, style: '风格（更新）' }), item.id,
  )
  update.close()
  original.close()

  const launch = () => electron.launch({
    executablePath,
    args: executablePath ? [] : [root],
    env: { ...process.env, BEERRANKING_TEST_DATA: data },
    timeout: 25_000,
  })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: '下一款，想喝什么？' })).toBeVisible()
    await app.evaluate(({ session }) => {
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] },
        (_details, callback) => callback({ cancel: true }))
    })
    await page.reload()
    await expect(page.getByRole('heading', { name: '下一款，想喝什么？' })).toBeVisible()
    await expect(page.locator('.beer-card').first()).toBeVisible()
    await page.screenshot({ path: join(work, 'qa', 'discover.png') })
    await page.locator('.hero-stats button').click()
    await expect(page.locator('.beer-card img').first()).toBeVisible()
    await page.screenshot({ path: join(work, 'qa', 'photos.png') })
    const search = page.getByRole('textbox', { name: '搜索啤酒' })
    await search.fill('33989')
    await page.locator('summary').filter({ hasText: /^风格/ }).click()
    await page.getByLabel(item.style!, { exact: true }).check()
    await page.locator('summary').filter({ hasText: /^风格/ }).click()
    await expect(page.getByText('1 款匹配')).toBeVisible()
    await page.getByRole('button', itemButton).click()
    await expect(page.getByRole('dialog', { name: '酒款详情' })).toContainText('咖啡')
    await expect(page.getByRole('dialog', { name: '酒款详情' })).toContainText('LCBO 商品编号')
    await expect.poll(() => page.locator('.detail-image img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    await page.getByRole('button', { name: '加入我的酒单' }).click()
    await page.getByLabel('标记为已喝').check()
    await page.getByLabel('评分（10 分制）').selectOption('0')
    await page.getByLabel('品饮日期').fill('2026-11-08')
    await page.getByLabel('我的短评').fill('品饮测试，柑橘清爽')
    await chooseFile(app, invalid)
    await page.getByRole('button', { name: '选择照片' }).click()
    await expect(page.getByRole('alert')).toContainText('有效的 JPG 或 PNG')
    await page.getByRole('button', { name: '关闭通知' }).click()
    await chooseFile(app, imagePath)
    await page.getByRole('button', { name: '选择照片' }).click()
    await expect(page.getByAltText('个人封面预览')).toBeVisible()
    await page.getByRole('button', { name: '保存记录' }).click()
    await expect(page.getByRole('dialog', { name: '酒款详情' })).toContainText('0.0')
    await expect(page.locator('.personal-detail img')).toBeVisible()
    await page.screenshot({ path: join(work, 'qa', 'detail.png') })
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('navigation').getByRole('button', { name: '评分排行' }).click()
    await expect(page.getByRole('button', itemButton)).toBeVisible()
    await page.getByRole('button', { name: '按品牌' }).click()
    await expect(page.getByRole('table')).toContainText('0.00')
    await page.getByRole('button', { name: '单品榜' }).click()

    await page.locator('summary').filter({ hasText: '预设' }).click()
    await page.getByRole('textbox', { name: '预设名称' }).fill('Guinness 搜索')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Guinness 搜索', exact: true })).toBeVisible()
    await page.locator('summary').filter({ hasText: '预设' }).click()
    await search.fill('不可匹配的文本')
    await expect(page.getByText('0 款匹配')).toBeVisible()
    await page.locator('summary').filter({ hasText: '预设' }).click()
    await page.getByRole('button', { name: 'Guinness 搜索', exact: true }).click()
    await expect(search).toHaveValue('33989')
    await page.locator('summary').filter({ hasText: '预设' }).click()

    const dataMenu = page.locator('.data-menu > summary')
    const csv = join(data, 'results.csv')
    await saveFile(app, csv)
    await dataMenu.click()
    await page.getByRole('button', { name: '导出当前结果' }).click()
    await expect(page.getByText('已导出筛选结果')).toBeVisible()
    const csvContent = readFileSync(csv, 'utf8')
    expect(csvContent.startsWith('\uFEFF')).toBe(true)
    expect(csvContent).toContain('"' + item.name + '"')
    expect(csvContent).toContain('33989')
    expect(csvContent).toContain('"0"')

    const backup = join(data, 'backup.sqlite')
    await saveFile(app, backup)
    await page.getByRole('button', { name: '备份个人记录' }).click()
    await expect(page.getByText('已保存个人备份')).toBeVisible()
    await dataMenu.click()
    await page.getByRole('button', itemButton).click()
    await page.getByRole('button', { name: '编辑品饮记录' }).click()
    await page.getByLabel('评分（10 分制）').selectOption('8.5')
    await page.getByRole('button', { name: '保存记录' }).click()
    await expect(page.getByRole('dialog', { name: '酒款详情' })).toContainText('8.5')
    await page.getByRole('button', { name: '关闭', exact: true }).click()

    await chooseFile(app, invalid)
    await dataMenu.click()
    await page.getByRole('button', { name: '恢复个人备份' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.locator('.score-badge').first()).toContainText('8.5')
    await chooseFile(app, backup)
    await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 0 })
    await page.getByRole('button', { name: '恢复个人备份' }).click()
    await expect(page.getByText('已恢复个人酒单')).toBeVisible()
    await expect(page.locator('.score-badge').first()).toContainText('0.0')
    await chooseFile(app, updated)
    await page.getByRole('button', { name: '移除筛选 ' + item.style }).click()
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
    await page.getByRole('button', { name: '加载离线目录包' }).click()
    await expect(page.getByText('已更新图鉴目录')).toBeVisible()
    await dataMenu.click()
    await page.getByRole('button', itemButton).click()
    await expect(page.getByRole('dialog', { name: '酒款详情' })).toContainText('风格（更新）')
    await expect(page.getByRole('dialog', { name: '酒款详情' })).toContainText('品饮测试，柑橘清爽')
    await expect(page.locator('.personal-detail img')).toBeVisible()

    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await page.getByRole('navigation').getByRole('button', { name: /我的酒单/ }).click()
    await expect(page.getByRole('button', itemButton)).toBeVisible()
    await expect(page.locator('.score-badge').first()).toContainText('0.0')
    await page.getByRole('button', { name: '添加啤酒' }).click()
    const form = page.getByRole('dialog', { name: '品饮记录' })
    await form.getByLabel('酒名').fill('Manual Test Lager')
    await form.getByLabel('品牌 / 酒厂').fill('Test Brewery')
    await form.getByLabel('风格').fill('拉格')
    await form.getByLabel('酒精度 %').fill('4.8')
    await form.getByRole('button', { name: '保存记录' }).click()
    await expect(page.getByRole('dialog', { name: '酒款详情' })).toContainText('Manual Test Lager')
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('navigation').getByRole('button', { name: '发现图鉴' }).click()
    await page.getByRole('textbox', { name: '搜索啤酒' }).fill('Manual Test Lager')
    await expect(page.getByText('0 款匹配')).toBeVisible()
  } finally {
    await app.close()
  }
})
