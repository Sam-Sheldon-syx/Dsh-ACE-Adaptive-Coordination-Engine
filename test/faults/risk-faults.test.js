import test from 'node:test'
import assert from 'node:assert/strict'
import { assessRisk } from '../../core/risk.js'
import { mergeConfig } from '../../core/config.js'

function candidate(kind = 'reassign', agentDelta = 0) {
  return { id: 'c1', actions: [{ kind }], heuristic: { agentDelta } }
}

function shadow(confidence, tokens = 100) {
  return {
    confidence,
    observations: {
      quality: { state: 'known', value: 0.8 },
      latencyMs: { state: 'known', value: 100 },
      tokens: { state: 'known', value: tokens },
      riskEvents: { state: 'known', value: 1 },
    },
  }
}

const small = { tasks: ['t1'], agents: ['a1'] }

test('F-30 token budget overrun is high risk', () => {
  const risk = assessRisk({
    candidate: candidate(),
    region: small,
    config: mergeConfig({ autoApply: true, budgets: { maxTokens: 10 } }),
    shadow: shadow('observed-limited', 100),
  })
  assert.equal(risk.level, 'high')
  assert.equal(risk.autoApplyAllowed, false)
  assert.ok(risk.factors.some((factor) => factor.kind === 'budget'))
})

test('F-31 unknown token cost is high risk', () => {
  const risk = assessRisk({
    candidate: candidate(),
    region: small,
    config: mergeConfig({ autoApply: true }),
    shadow: {
      confidence: 'observed-limited',
      observations: { tokens: { state: 'unknown', reason: 'meter unavailable' } },
    },
  })
  assert.equal(risk.level, 'high')
  assert.equal(risk.autoApplyAllowed, false)
})

test('F-32 large blast radius is high risk', () => {
  const risk = assessRisk({
    candidate: candidate(),
    region: { tasks: Array.from({ length: 9 }, (_, i) => `t${i}`), agents: ['a1'] },
    config: mergeConfig({ autoApply: true }),
    shadow: shadow('observed-limited'),
  })
  assert.equal(risk.level, 'high')
})

test('F-33 missing evidence blocks auto-apply', () => {
  const risk = assessRisk({
    candidate: candidate(),
    region: small,
    config: mergeConfig({ autoApply: true }),
    shadow: { confidence: 'none', observations: {} },
  })
  assert.equal(risk.level, 'high')
  assert.equal(risk.autoApplyAllowed, false)
})

test('F-34 observed low-risk change remains eligible (negative control)', () => {
  const risk = assessRisk({
    candidate: candidate(),
    region: small,
    config: mergeConfig({ autoApply: true }),
    shadow: shadow('observed-limited'),
  })
  assert.equal(risk.level, 'low')
  assert.equal(risk.autoApplyAllowed, true)
})
