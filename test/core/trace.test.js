import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTrace, replayTrace } from '../../core/trace.js'
import { sampleEvents } from './fixtures.js'

test('normalizes contiguous events and extracts task metrics', () => {
  const trace = normalizeTrace(sampleEvents())
  assert.equal(trace.window.count, 11)
  assert.equal(trace.tasks.length, 2)
  assert.equal(trace.agents.length, 2)
  const t1 = trace.metrics.tasks.t1
  assert.equal(t1.attempts, 1)
  assert.equal(t1.failures, 1)
  assert.equal(t1.retries, 1)
  assert.equal(t1.tokens, 150)
  assert.equal(t1.latencyMs, 3000)
  assert.equal(t1.unresolvedCalls, 0)
  assert.equal(trace.summary.failures, 1)
  assert.equal(trace.summary.retries, 1)
})

test('rejects non-contiguous sequence numbers', () => {
  const events = sampleEvents()
  events[5].seq = 99
  assert.throws(() => normalizeTrace(events), (error) => error.code === 'TRACE_CORRUPT')
})

test('rejects unknown non-ignorable event types', () => {
  const events = sampleEvents()
  events.push({ seq: 11, type: 'plugin/custom', data: {} })
  assert.throws(() => normalizeTrace(events), (error) => error.code === 'TRACE_CORRUPT')
})

test('keeps unknown ignorable events without metrics', () => {
  const events = sampleEvents()
  events.push({ seq: 11, type: 'plugin/custom', data: {}, ignorable: true })
  const trace = normalizeTrace(events)
  assert.equal(trace.window.count, 12)
})

test('rejects invalid event data objects', () => {
  const events = sampleEvents()
  events[0].data = null
  assert.throws(() => normalizeTrace(events), (error) => error.code === 'TRACE_CORRUPT')
})

test('empty trace is explicit and not invented', () => {
  const trace = normalizeTrace([])
  assert.equal(trace.window.count, 0)
  assert.equal(trace.window.confidence, 'none')
  assert.deepEqual(replayTrace(trace), {
    fromSeq: 0,
    toSeqExclusive: 0,
    eventCount: 0,
    tasks: 0,
    agents: 0,
    failures: 0,
    retries: 0,
    tokens: 0,
    latencyMs: 0,
    truncated: false,
    confidence: 'none',
  })
})
