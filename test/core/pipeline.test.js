import test from 'node:test'
import assert from 'node:assert/strict'
import { analyze } from '../../core/pipeline.js'
import { sampleEvents, sampleTopology } from './fixtures.js'

function config() {
  return {
    simulation: { reassignQuality: 0.3, uncertainty: 0.01 },
    thresholds: { inconclusiveDelta: 0.001 },
  }
}

test('pipeline produces candidates, shadows and a decision deterministically', async () => {
  const input = {
    events: sampleEvents(),
    topology: sampleTopology(),
    config: config(),
  }
  const first = await analyze(input)
  const second = await analyze(input)
  assert.deepEqual(first, second)
  assert.ok(first.candidates.length > 0)
  assert.ok(first.shadowRuns.length > 0)
  assert.equal(first.scoring.best !== null, true)
  assert.equal(first.decision.kind, 'request-approval')
  assert.equal(first.outcome, 'reported')
  assert.match(first.runId, /^run-[a-f0-9]{16}$/)
})

test('empty trace yields an explicit no-op instead of invented candidates', async () => {
  const run = await analyze({ events: [], topology: sampleTopology(), config: config() })
  assert.equal(run.candidates.length, 0)
  assert.deepEqual(run.decision, { kind: 'no-op', reason: 'no-candidate' })
  assert.equal(run.anomalies.length, 0)
})

test('shadowMode off is inconclusive rather than fabricated', async () => {
  const run = await analyze({
    events: sampleEvents(),
    topology: sampleTopology(),
    config: { ...config(), shadowMode: 'off' },
  })
  assert.ok(run.candidates.length > 0)
  assert.equal(run.decision.kind, 'no-op')
  assert.equal(run.decision.reason, 'inconclusive')
})

test('autoApply stays disabled for simulated evidence', async () => {
  const run = await analyze({
    events: sampleEvents(),
    topology: sampleTopology(),
    config: { ...config(), autoApply: true },
  })
  assert.equal(run.decision.kind, 'request-approval')
  assert.equal(run.decision.risk.autoApplyAllowed, false)
})
