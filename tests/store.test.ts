import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { backup } from 'node:sqlite'
import { test } from 'node:test'
import { CatalogStore, LibraryStore, mergeEntries } from '../src/main/store.ts'
import { cleanSettings } from '../src/shared/query.ts'
import type { Draft } from '../src/shared/model.ts'

test('personal photos, zero scores and presets survive backup and atomic restore', async () => {
  mkdirSync(resolve('.tools'), { recursive: true })
  const directory = mkdtempSync(resolve('.tools', 'library-test-'))
  const database = new LibraryStore(join(directory, 'library.sqlite'))
  try {
    const draft: Draft = {
      id: null, name: 'Échantillon', brand: 'QC', style: 'IPA', origin: '魁北克', abv: 5.5,
      tasted: true, score: 0, review: '个人记录', date: '2026-11-08', photo: { action: 'replace', token: 'test' },
    }
    const image = new Uint8Array([255, 216, 255, 224])
    const id = database.save(draft, null, { cover: image, thumb: image })
    database.savePreset({ ...cleanSettings({ filters: { maxScore: 0 } }), name: '零分记录' })
    const snapshot = join(directory, 'backup.sqlite')
    await backup(database.db, snapshot)
    database.save({ ...draft, id, score: 9.5, photo: { action: 'remove' } }, null)
    const bad = join(directory, 'bad.sqlite')
    writeFileSync(bad, 'corrupt data')
    assert.throws(() => database.restore(bad, () => true))
    assert.equal(database.get(id)?.record?.score, 9.5)
    assert.equal(database.restore(snapshot, () => false), false)
    assert.equal(database.restore(snapshot, () => true), true)
    assert.equal(database.get(id)?.record?.score, 0)
    assert.deepEqual(database.photo(id, true), image)
    assert.equal(database.presets()[0].filters.maxScore, 0)
  } finally {
    database.db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('bundled public catalogue validates independently of private data', () => {
  const catalog = new CatalogStore('catalog/beer-catalog.sqlite', true)
  try {
    assert.equal(catalog.info.dataset, 'lcbo')
    assert.ok(catalog.info.count > 500)
    assert.ok([...catalog.entries.values()].every(entry => entry.lcboSkus?.length
      && entry.sources.every(source => new URL(source.url).host === 'www.lcbo.com')))
    const example = [...catalog.entries.values()].find(entry => entry.hasPhoto)!
    assert.ok(example.photoCredit?.licenseUrl)
    assert.ok(catalog.photo(example.id, true)?.length)
    assert.equal(mergeEntries(catalog.entries, new Map()).length, catalog.info.count)
  } finally {
    catalog.close()
  }
})

test('old personal records relink by official SKU without replacing their photos or reviews', () => {
  mkdirSync(resolve('.tools'), { recursive: true })
  const directory = mkdtempSync(resolve('.tools', 'library-migration-'))
  const catalog = new CatalogStore('catalog/beer-catalog.sqlite')
  const database = new LibraryStore(join(directory, 'library.sqlite'))
  try {
    const match = [...catalog.entries.values()].find(entry => entry.lcboSkus?.includes('33989'))!
    const draft: Draft = {
      id: 'old-guinness', name: '旧记录', brand: '旧品牌', style: '', origin: '', abv: null,
      tasted: true, score: 0, review: '保留这条短评', date: '2026-11-08', photo: { action: 'replace', token: 'test' },
    }
    const photo = new Uint8Array([255, 216, 255, 224])
    database.save(draft, { ...match, id: 'old-guinness', name: '旧记录', lcboSkus: undefined,
      sources: [{ label: 'LCBO', url: 'https://www.lcbo.com/en/guinness-0-33989', license: '参考' }] },
    { cover: photo, thumb: photo })
    database.save({ ...draft, id: 'old-unmatched', photo: { action: 'keep' } },
      { ...match, id: 'old-unmatched', name: '私人旧记录', lcboSkus: undefined, barcodes: [], sources: [] })
    database.relink(catalog.entries)
    database.relink(catalog.entries)
    assert.equal(database.get('old-guinness'), null)
    assert.equal(database.get(match.id)?.record?.score, 0)
    assert.equal(database.get(match.id)?.record?.review, '保留这条短评')
    assert.deepEqual(database.photo(match.id, true), photo)
    const orphan = mergeEntries(catalog.entries, database.all()).find(entry => entry.id === 'old-unmatched')
    assert.equal(orphan?.record?.review, '保留这条短评')
    assert.equal(orphan?.style, null)
    assert.deepEqual(orphan?.sources, [])
  } finally {
    database.db.close()
    catalog.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
