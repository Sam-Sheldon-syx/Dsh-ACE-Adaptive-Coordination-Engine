import test from 'node:test'
import assert from 'node:assert/strict'
import { assessRisk, canAutoApply } from '../../core/risk.js'
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

const region = { tasks: ['t1'], agents: ['a1'] }

test('observed low-risk simulated-free change can auto-apply', () => {
  const config = mergeConfig({ autoApply: true })
  const risk = assessRisk({
    candidate: candidate('reassign'),
    region,
    config,
    shadow: shadow('observed-limited'),
  })
  assert.equal(risk.level, 'low')
  assert.equal(risk.autoApplyAllowed, true)
  assert.equal(canAutoApply(risk, config), true)
})

test('simulated shadow cannot auto-apply', () => {
  const config = mergeConfig({ autoApply: true })
  const risk = assessRisk({
    candidate: candidate('reassign'),
    region,
    config,
    shadow: shadow('simulated'),
  })
  assert.equal(risk.level, 'medium')
  assert.equal(risk.requiresApproval, true)
  assert.equal(risk.autoApplyAllowed, false)
})

test('missing evidence is high risk and blocked from auto-apply', () => {
  const risk = assessRisk({
    candidate: candidate('reassign'),
    region,
    config: mergeConfig(),
    shadow: { confidence: 'none', observations: {} },
  })
  assert.equal(risk.level, 'high')
  assert.equal(risk.autoApplyAllowed, false)
})

test('structural change adds medium severity', () => {
  const risk = assessRisk({
    candidate: candidate('add-helper', 1),
    region,
    config: mergeConfig({ autoApply: true }),
    shadow: shadow('observed-limited'),
  })
  assert.equal(risk.level, 'medium')
  assert.ok(risk.factors.some((factor) => factor.kind === 'agent-delta'))
})

test('budget overrun or unknown cost is high risk', () => {
  const over = assessRisk({
    candidate: candidate('reassign'),
    region,
    config: mergeConfig({ budgets: { maxTokens: 10 } }),
    shadow: shadow('observed-limited', 100),
  })
  assert.equal(over.level, 'high')
  const unknown = assessRisk({
    candidate: candidate('reassign'),
    region,
    config: mergeConfig(),
    shadow: { confidence: 'observed-limited', observations: { tokens: { state: 'unknown', reason: 'x' } } },
  })
  assert.equal(unknown.level, 'high')
})
