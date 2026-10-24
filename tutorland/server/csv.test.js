import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCsv, stringifyCsv } from './csv.js'

test('CSV round-trips commas, line breaks, quotes and empty values', () => {
  const headers = ['name', 'comment', 'empty']
  const rows = [{ name: 'Ala, Ola', comment: 'Lekcja "super"\ni pomocna', empty: '' }]
  assert.deepEqual(parseCsv(stringifyCsv(headers, rows)), rows)
})

test('CSV parser rejects an unclosed quoted field', () => {
  assert.throws(() => parseCsv('name,comment\nAla,"brak końca'), /niedomknięty cudzysłów/)
})
