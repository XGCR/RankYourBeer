import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Entry } from '../src/shared/model.ts'
import { cleanQuery, filterEntries, groupEntries, makeCsv, queryEntries } from '../src/shared/query.ts'

function entry(id: string, name: string, changes: Partial<Entry> = {}): Entry {
  return {
    id, name, brand: 'Unibroue', style: '三料艾尔', abv: 9, brewery: null, flavors: [],
    tastingNotes: null, origin: null, barcodes: [], marketRegions: [], sources: [], hasPhoto: false,
    photoCredit: null, record: null, ...changes,
  }
}

const rated = (score: number | null, date: string | null = null) => ({
  score, date, tasted: true, hasPhoto: false, review: '',
})
const beers = [
  entry('one', 'Péché Mortel', { brand: 'Dieu du Ciel', style: '世涛', flavors: ['咖啡'], tastingNotes: '咖啡', hasPhoto: true }),
  entry('two', 'La Fin du Monde', { record: rated(8, '2026-11-01') }),
  entry('three', 'Blanche de Chambly', { style: '小麦啤酒', abv: 5, record: rated(8, '2026-11-07') }),
  entry('four', 'Rated Zero', { abv: 0, record: rated(0) }),
  entry('five', 'Unrated', { abv: null, record: rated(null) }),
]

test('search, facets and ranges combine while zero is a real score', () => {
  const query = cleanQuery({ filters: {
    search: 'PECHE dieu', brands: ['Unibroue', 'Dieu du Ciel'], flavors: ['咖啡'], completeness: 'complete',
  } })
  assert.deepEqual(filterEntries(beers, query.filters).map(row => row.id), ['one'])
  assert.deepEqual(filterEntries(beers, cleanQuery({ filters: { minScore: 0, maxScore: 0, maxAbv: 0 } }).filters)
    .map(row => row.id), ['four'])
})

test('ranking excludes unrated entries, uses secondary dates and includes zero in the mean', () => {
  const view = queryEntries(beers, cleanQuery({
    mode: 'ranking', primary: { field: 'score', direction: 'desc' }, secondary: { field: 'date', direction: 'desc' },
  }))
  assert.deepEqual(view.rows.map(row => row.id), ['three', 'two', 'four'])
  assert.deepEqual(groupEntries(beers.filter(row => row.record), 'brand'), [
    { label: 'Unibroue', count: 4, scored: 3, average: 16 / 3 },
  ])
})

test('unknown ABV sorts last in either direction, CSV uses the same row order', () => {
  for (const direction of ['asc', 'desc']) {
    const { sorted } = queryEntries(beers, cleanQuery({ primary: { field: 'abv', direction } }))
    assert.equal(sorted.at(-1)?.id, 'five')
    assert.match(makeCsv(sorted).trimEnd().split('\r\n').at(-1)!, /^"Unrated"/u)
  }
  assert.match(makeCsv([entry('six', '=@formula', { brand: 'B, "C"' })]), /"'=@formula","B, ""C"""/u)
})
