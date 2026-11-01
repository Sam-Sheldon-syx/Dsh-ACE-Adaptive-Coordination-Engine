import test from 'node:test'
import assert from 'node:assert/strict'
import { analyze } from '../../core/pipeline.js'
import { sampleEvents, sampleTopology } from '../core/fixtures.js'

function config(overrides = {}) {
  return {
    simulation: { reassignQuality: 0.3, uncertainty: 0.01 },
    thresholds: { inconclusiveDelta: 0.001 },
    ...overrides,
  }
}

test('F-40 empty window yields no-op, not fabricated candidates', async () => {
  const run = await analyze({ events: [], topology: sampleTopology(), config: config() })
  assert.deepEqual(run.decision, { kind: 'no-op', reason: 'no-candidate' })
  assert.equal(run.candidates.length, 0)
})

test('F-41 unavailable live shadow fails closed into inconclusive', async () => {
  const run = await analyze({
    events: sampleEvents(),
    topology: sampleTopology(),
    config: config({ shadowMode: 'live-fork' }),
  })
  assert.ok(run.shadowRuns.some((shadow) => shadow.verdict === 'failed'))
  assert.equal(run.decision.kind, 'no-op')
  assert.equal(run.decision.reason, 'inconclusive')
})

test('F-42 shadow off cannot produce an apply decision', async () => {
  const run = await analyze({
    events: sampleEvents(),
    topology: sampleTopology(),
    config: config({ shadowMode: 'off' }),
  })
  assert.equal(run.decision.kind, 'no-op')
  assert.equal(run.decision.reason, 'inconclusive')
})

test('F-43 autoApply is not reachable from simulated evidence', async () => {
  const run = await analyze({
    events: sampleEvents(),
    topology: sampleTopology(),
    config: config({ autoApply: true }),
  })
  assert.equal(run.decision.kind, 'request-approval')
  assert.equal(run.decision.risk.autoApplyAllowed, false)
})

test('F-44 corrupted trace aborts instead of silently continuing', async () => {
  const events = sampleEvents()
  events[3].seq = 99
  await assert.rejects(
    analyze({ events, topology: sampleTopology(), config: config() }),
    (error) => error.code === 'TRACE_CORRUPT',
  )
})
