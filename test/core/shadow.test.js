import test from 'node:test'
import assert from 'node:assert/strict'
import { baselineFromTrace, simulateCandidate } from '../../core/shadow.js'
import { mergeConfig } from '../../core/config.js'
import { normalizeTrace } from '../../core/trace.js'
import { sampleEvents } from './fixtures.js'

function candidate(overrides = {}) {
  return {
    id: 'cand-1',
    actions: [{ kind: 'reassign', taskId: 't1', toAgent: 'a2' }],
    ...overrides,
  }
}

test('baseline derives from trace metrics without inventing values', () => {
  const trace = normalizeTrace(sampleEvents())
  const baseline = baselineFromTrace(trace)
  assert.equal(baseline.quality, 0)
  assert.equal(baseline.tokens, 150)
  assert.equal(baseline.riskEvents, 2)
  assert.equal(baseline.known, true)
})

test('replay simulation is deterministic and labelled simulated', async () => {
  const trace = normalizeTrace(sampleEvents())
  const baseline = baselineFromTrace(trace)
  const config = mergeConfig({ simulation: { reassignQuality: 0.2, uncertainty: 0.01 } })
  const first = await simulateCandidate({ candidate: candidate(), baseline, config })
  const second = await simulateCandidate({ candidate: candidate(), baseline, config })
  assert.deepEqual(first, second)
  assert.equal(first.mode, 'replay')
  assert.equal(first.confidence, 'simulated')
  assert.equal(first.observations.quality.state, 'known')
  assert.equal(first.observations.quality.value, 0.2)
  assert.equal(first.verdict, 'better')
})

test('unknown baseline yields unknown observations', async () => {
  const baseline = baselineFromTrace(normalizeTrace([]))
  const result = await simulateCandidate({
    candidate: candidate(),
    baseline,
    config: mergeConfig(),
  })
  assert.equal(result.observations.quality.state, 'unknown')
  assert.equal(result.verdict, 'inconclusive')
})

test('live-fork without runner fails closed', async () => {
  const baseline = baselineFromTrace(normalizeTrace(sampleEvents()))
  await assert.rejects(
    simulateCandidate({
      candidate: candidate(),
      baseline,
      config: mergeConfig({ shadowMode: 'live-fork' }),
      mode: 'live-fork',
    }),
    (error) => error.code === 'SHADOW_UNAVAILABLE',
  )
})

test('off mode reports no confidence', async () => {
  const result = await simulateCandidate({
    candidate: candidate(),
    baseline: baselineFromTrace(normalizeTrace(sampleEvents())),
    config: mergeConfig(),
    mode: 'off',
  })
  assert.equal(result.confidence, 'none')
  assert.equal(result.verdict, 'inconclusive')
})
