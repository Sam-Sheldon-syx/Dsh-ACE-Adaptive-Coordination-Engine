import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTrace } from '../../core/trace.js'
import { detectAnomalies } from '../../core/anomaly.js'
import { mergeConfig } from '../../core/config.js'
import { sampleEvents } from '../core/fixtures.js'

function detect(events) {
  return detectAnomalies(normalizeTrace(events), mergeConfig())
}

function taskEvents(extra = []) {
  const t0 = Date.parse('2026-11-01T00:00:00.000Z')
  const at = (ms) => new Date(t0 + ms).toISOString()
  const base = [
    { seq: 0, time: at(0), type: 'team/task', data: { taskId: 'a', status: 'running' } },
    { seq: 1, time: at(0), type: 'team/task', data: { taskId: 'b', status: 'running' } },
    { seq: 2, time: at(0), type: 'team/task', data: { taskId: 'c', status: 'running' } },
  ]
  return base.concat(extra.map((event, index) => ({ ...event, seq: 3 + index })))
}

test('F-10 subtask failure is a hard-rule anomaly', () => {
  const detection = detect(sampleEvents())
  const task = detection.anomalies.find((entry) => entry.entity.id === 't1')
  assert.ok(task)
  assert.equal(task.hardRule, true)
})

test('F-11 retry storm is a hard-rule anomaly', () => {
  const detection = detect(taskEvents([
    { type: 'llm/retry', data: { taskId: 'a', agentId: 'lead' } },
    { type: 'llm/retry', data: { taskId: 'a', agentId: 'lead' } },
    { type: 'llm/retry', data: { taskId: 'a', agentId: 'lead' } },
  ]))
  const task = detection.anomalies.find((entry) => entry.entity.id === 'a')
  assert.ok(task)
  assert.equal(task.hardRule, true)
})

test('F-12 stalled tool call is a hard-rule anomaly', () => {
  const detection = detect(taskEvents([
    { type: 'tool/call', data: { taskId: 'a', callId: 'c1' } },
  ]))
  const task = detection.anomalies.find((entry) => entry.entity.id === 'a')
  assert.ok(task)
  assert.equal(task.hardRule, true)
})

test('F-13 token spike crosses the anomaly threshold', () => {
  const detection = detect(taskEvents([
    { type: 'assistant/message', data: { taskId: 'a', tokens: 100000 } },
    { type: 'assistant/message', data: { taskId: 'b', tokens: 10 } },
  ]))
  assert.ok(detection.anomalies.some((entry) => entry.entity.id === 'a'))
})

test('F-14 latency timeout crosses the anomaly threshold', () => {
  const t0 = Date.parse('2026-11-01T00:00:00.000Z')
  const at = (ms) => new Date(t0 + ms).toISOString()
  const detection = detect(taskEvents([
    { time: at(0), type: 'step/start', data: { taskId: 'a', agentId: 'lead' } },
    { time: at(600000), type: 'step/end', data: { taskId: 'a', agentId: 'lead' } },
    { time: at(0), type: 'step/start', data: { taskId: 'b', agentId: 'lead' } },
    { time: at(100), type: 'step/end', data: { taskId: 'b', agentId: 'lead' } },
  ]))
  assert.ok(detection.anomalies.some((entry) => entry.entity.id === 'a'))
})
