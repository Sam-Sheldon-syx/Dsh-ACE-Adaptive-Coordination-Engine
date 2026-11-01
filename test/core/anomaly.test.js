import test from 'node:test'
import assert from 'node:assert/strict'
import { detectAnomalies } from '../../core/anomaly.js'
import { mergeConfig } from '../../core/config.js'
import { normalizeTrace } from '../../core/trace.js'
import { sampleEvents } from './fixtures.js'

test('detects a hard-rule task failure deterministically', () => {
  const trace = normalizeTrace(sampleEvents())
  const detection = detectAnomalies(trace, mergeConfig())
  const t1 = detection.anomalies.find((entry) => entry.entity.id === 't1')
  assert.ok(t1)
  assert.equal(t1.hardRule, true)
  assert.ok(detection.seeds.some((seed) => seed.id === 't1'))
})

test('empty trace produces no anomalies', () => {
  const trace = normalizeTrace([])
  const detection = detectAnomalies(trace, mergeConfig())
  assert.deepEqual(detection.anomalies, [])
})

test('anomaly order is stable', () => {
  const trace = normalizeTrace(sampleEvents())
  const a = detectAnomalies(trace, mergeConfig())
  const b = detectAnomalies(trace, mergeConfig())
  assert.deepEqual(a.anomalies, b.anomalies)
})

test('threshold filters low-score entities without hard rules', () => {
  const trace = normalizeTrace([
    { seq: 0, time: '2026-11-01T00:00:00Z', type: 'team/task', data: { taskId: 'x', status: 'running' } },
    { seq: 1, time: '2026-11-01T00:00:00Z', type: 'team/task', data: { taskId: 'y', status: 'running' } },
  ])
  const detection = detectAnomalies(trace, mergeConfig({ thresholds: { anomaly: 10 } }))
  assert.deepEqual(detection.anomalies, [])
})
