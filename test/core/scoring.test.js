import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreCandidates } from '../../core/scoring.js'
import { mergeConfig } from '../../core/config.js'

function shadow(id, quality, latencyMs, tokens, riskEvents, confidence = 'simulated') {
  return {
    candidateId: id,
    confidence,
    observations: {
      quality: { state: 'known', value: quality },
      latencyMs: { state: 'known', value: latencyMs },
      tokens: { state: 'known', value: tokens },
      riskEvents: { state: 'known', value: riskEvents },
    },
  }
}

function cand(id, agentDelta = 0) {
  return { id, heuristic: { agentDelta } }
}

test('scores and ranks candidates with visible normalization', () => {
  const candidates = [cand('c1'), cand('c2')]
  const shadows = [shadow('c1', 0.9, 100, 100, 1), shadow('c2', 0.6, 200, 50, 2)]
  const baseline = { quality: 0.5, latencyMs: 150, tokens: 120, riskEvents: 2 }
  const result = scoreCandidates({ candidates, shadows, baseline, config: mergeConfig() })
  assert.equal(result.scored.length, 2)
  assert.ok(result.scored.every((row) => row.utility >= 0 && row.utility <= 1))
  assert.equal(result.scored[0].candidateId, 'c1')
  assert.ok(result.delta !== null)
})

test('missing observations lower confidence and force inconclusive', () => {
  const candidates = [cand('c1')]
  const shadows = [{ candidateId: 'c1', confidence: 'none', observations: {
    quality: { state: 'unknown', reason: 'x' },
    latencyMs: { state: 'unknown', reason: 'x' },
    tokens: { state: 'unknown', reason: 'x' },
    riskEvents: { state: 'unknown', reason: 'x' },
  } }]
  const result = scoreCandidates({
    candidates,
    shadows,
    baseline: { quality: null, latencyMs: null, tokens: null, riskEvents: null },
    config: mergeConfig(),
  })
  assert.equal(result.inconclusive, true)
})

test('tiny improvement is inconclusive under the configured threshold', () => {
  const candidates = [cand('c1')]
  const shadows = [shadow('c1', 0.701, 100, 100, 1)]
  const result = scoreCandidates({
    candidates,
    shadows,
    baseline: { quality: 0.7, latencyMs: 100, tokens: 100, riskEvents: 1 },
    config: mergeConfig({ thresholds: { inconclusiveDelta: 0.02 } }),
  })
  assert.equal(result.inconclusive, true)
})

test('pareto flags at least one non-dominated candidate', () => {
  const candidates = [cand('c1'), cand('c2')]
  const shadows = [shadow('c1', 0.9, 100, 100, 1), shadow('c2', 0.6, 200, 50, 2)]
  const result = scoreCandidates({
    candidates,
    shadows,
    baseline: { quality: 0.5, latencyMs: 150, tokens: 120, riskEvents: 2 },
    config: mergeConfig(),
  })
  assert.ok(result.scored.some((row) => row.pareto))
})
