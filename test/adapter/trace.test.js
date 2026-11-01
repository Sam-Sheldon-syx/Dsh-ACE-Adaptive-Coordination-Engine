import test from 'node:test'
import assert from 'node:assert/strict'
import { mapDshEvents, readDshSession, extractSessionEvents } from '../../ace-plugin/adapter/trace.js'
import { normalizeTrace } from '../../core/trace.js'
import { dshEvents } from './fixtures.js'

test('maps real DSH events into a core-compatible trace', () => {
  const mapped = mapDshEvents(dshEvents(), { sessionId: 'sess-1' })
  assert.equal(mapped.stats.inputEvents, 7)
  assert.equal(mapped.stats.headerEvents, 1)
  assert.equal(mapped.stats.toolCalls, 1)
  assert.equal(mapped.stats.toolResults, 1)
  assert.equal(mapped.stats.failures, 1)
  assert.equal(mapped.stats.tokens, 15)
  assert.equal(mapped.stats.tasks, 1)
  assert.equal(mapped.stats.members, 1)

  const trace = normalizeTrace(mapped.events)
  assert.equal(trace.metrics.tasks['step:1:1'].failures, 1)
  assert.equal(trace.metrics.tasks['step:1:1'].tokens, 15)
  assert.equal(trace.metrics.tasks['step:1:1'].latencyMs, 1000)
  assert.equal(trace.agents.some((agent) => agent.id === 'a1'), true)
})

test('mapped topology is synthetic step model and assigned to lead', () => {
  const mapped = mapDshEvents(dshEvents(), { sessionId: 'sess-1' })
  assert.equal(mapped.topology.taskModel, 'steps')
  assert.equal(mapped.topology.tasks.length, 1)
  assert.deepEqual(mapped.topology.assignments, [{ taskId: 'step:1:1', agentId: 'lead' }])
  assert.ok(mapped.topology.agents.some((agent) => agent.id === 'a1'))
})

test('extractSessionEvents accepts common service result shapes', () => {
  assert.deepEqual(extractSessionEvents([{ seq: 0 }]), [{ seq: 0 }])
  assert.deepEqual(extractSessionEvents({ events: [{ seq: 1 }] }), [{ seq: 1 }])
  assert.deepEqual(extractSessionEvents({ records: [{ event: { seq: 2 } }] }), [{ seq: 2 }])
  assert.equal(extractSessionEvents({ nope: true }), null)
})

test('readDshSession prefers sessionQuery', async () => {
  const ctx = { sessionQuery: { readSession: async () => ({ events: dshEvents() }) } }
  const result = await readDshSession(ctx, 'sess-1')
  assert.equal(result.source, 'sessionQuery')
  assert.equal(result.events.length, 7)
})

test('readDshSession falls back to sessions.snapshotEvents', async () => {
  const events = dshEvents().filter((event) => Number.isInteger(event.seq))
  const ctx = {
    sessions: {
      get: async () => ({ seq: events.length, snapshotEvents: () => events }),
    },
  }
  const result = await readDshSession(ctx, 'sess-1')
  assert.equal(result.source, 'sessions.snapshotEvents')
})

test('readDshSession fails closed without services', async () => {
  await assert.rejects(readDshSession({}, 'sess-1'), (error) => error.code === 'TRACE_UNAVAILABLE')
})
