/**
 * Default ACE configuration.
 * Every numeric value is a PLACEHOLDER that has NOT been calibrated with
 * experiments. P9 is the first stage allowed to make effect claims.
 */

export const DEFAULT_CONFIG = Object.freeze({
  shadowMode: 'replay', // 'replay' | 'live-fork' | 'off'
  autoApply: false,
  maxCandidates: 5,
  maxAgentDelta: 2,
  maxHops: 2,
  regionMaxNodes: 24,
  weights: Object.freeze({
    quality: 0.4,
    latency: 0.2,
    tokens: 0.2,
    risk: 0.2,
    reconfig: 0.05,
  }),
  thresholds: Object.freeze({
    anomaly: 1.0,
    zMax: 6,
    splitTokens: 1200,
    autoApplyQualityGain: 0.05,
    inconclusiveDelta: 0.02,
  }),
  signalWeights: Object.freeze({
    failures: 1.0,
    retries: 0.6,
    latency: 0.4,
    tokens: 0.3,
    stalls: 0.8,
    coordination: 0.2,
  }),
  hardRules: Object.freeze({
    failure: true,
    stalledCall: true,
    retries: 3,
  }),
  simulation: Object.freeze({
    reassignQuality: 0.02,
    splitQuality: 0.01,
    addHelperQuality: 0.03,
    rewireQuality: 0.005,
    retryQuality: 0.01,
    latencyFactor: 0.95,
    tokenFactor: 0.95,
    riskFactor: 0.9,
    uncertainty: 0.15,
  }),
  budgets: Object.freeze({
    maxTokens: 200000,
    maxMs: 600000,
    maxRefactorsPerSession: 3,
  }),
  toolAllowlist: Object.freeze({
    liveShadow: Object.freeze([]),
  }),
})

/** Deep merge for the two-level config shape used here. */
export function mergeConfig(overrides = {}) {
  const base = DEFAULT_CONFIG
  const merged = {
    ...base,
    ...overrides,
    weights: { ...base.weights, ...(overrides.weights ?? {}) },
    thresholds: { ...base.thresholds, ...(overrides.thresholds ?? {}) },
    signalWeights: { ...base.signalWeights, ...(overrides.signalWeights ?? {}) },
    hardRules: { ...base.hardRules, ...(overrides.hardRules ?? {}) },
    simulation: { ...base.simulation, ...(overrides.simulation ?? {}) },
    budgets: { ...base.budgets, ...(overrides.budgets ?? {}) },
    toolAllowlist: { ...base.toolAllowlist, ...(overrides.toolAllowlist ?? {}) },
  }
  if (!['replay', 'live-fork', 'off'].includes(merged.shadowMode)) {
    throw new Error(`invalid shadowMode: ${merged.shadowMode}`)
  }
  if (!(merged.maxCandidates > 0)) throw new Error('maxCandidates must be positive')
  return merged
}
