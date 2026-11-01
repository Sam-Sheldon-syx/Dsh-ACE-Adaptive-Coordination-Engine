import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTrace } from '../../core/trace.js'
import { sampleEvents } from '../core/fixtures.js'

test('F-01 sequence gap is rejected as trace corruption', () => {
  const events = sampleEvents()
  events[5].seq = 99
  assert.throws(() => normalizeTrace(events), (error) => error.code === 'TRACE_CORRUPT')
})

test('F-02 unknown non-ignorable event is rejected', () => {
  const events = sampleEvents()
  events.push({ seq: 11, type: 'plugin/unknown', data: {} })
  assert.throws(() => normalizeTrace(events), (error) => error.code === 'TRACE_CORRUPT')
})

test('F-03 explicit null event data is rejected', () => {
  const events = sampleEvents()
  events[0].data = null
  assert.throws(() => normalizeTrace(events), (error) => error.code === 'TRACE_CORRUPT')
})

test('F-04 empty trace stays explicit instead of inventing tasks', () => {
  const trace = normalizeTrace([])
  assert.equal(trace.window.confidence, 'none')
  assert.equal(trace.tasks.length, 0)
  assert.equal(trace.agents.length, 0)
})
