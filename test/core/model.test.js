import test from 'node:test'
import assert from 'node:assert/strict'
import { AceError, canonicalJson, hashOf, clamp, median, mad, mean, round } from '../../core/model.js'

test('canonicalJson is stable across key order', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}')
})

test('hashOf is deterministic', () => {
  assert.equal(hashOf({ a: 1, b: 2 }), hashOf({ b: 2, a: 1 }))
  assert.notEqual(hashOf({ a: 1 }), hashOf({ a: 2 }))
})

test('AceError carries code/retryable/detail', () => {
  const error = new AceError('TRACE_CORRUPT', 'bad', { retryable: true, detail: { seq: 3 } })
  assert.equal(error.code, 'TRACE_CORRUPT')
  assert.equal(error.retryable, true)
  assert.deepEqual(error.detail, { seq: 3 })
})

test('numeric helpers handle empty input', () => {
  assert.equal(mean([]), null)
  assert.equal(median([]), null)
  assert.equal(mad([]), null)
  assert.equal(clamp(5, 0, 3), 3)
  assert.equal(round(1.23456, 2), 1.23)
})
