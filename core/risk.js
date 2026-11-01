/**
 * Risk grading and apply gates.
 * Fail-closed: missing evidence never auto-applies.
 */

const SEVERITY_ORDER = { low: 0, medium: 1, high: 2 }

/**
 * @param {{candidate: object, region: object, config: object, shadow?: object}} input
 */
export function assessRisk(input) {
  const { candidate, region, config, shadow } = input
  const factors = []
  const actions = candidate.actions ?? []
  const kinds = new Set(actions.map((action) => action.kind))
  const agentDelta = candidate.heuristic?.agentDelta ?? 0
  const regionSize = (region?.tasks?.length ?? 0) + (region?.agents?.length ?? 0)
  const confidence = shadow?.confidence ?? 'none'

  for (const kind of kinds) {
    if (kind === 'split' || kind === 'add-helper') {
      factors.push({ kind, detail: 'structural change', severity: 'medium' })
    } else {
      factors.push({ kind, detail: 'reversible routing/config change', severity: 'low' })
    }
  }

  if (agentDelta > 0) {
    factors.push({ kind: 'agent-delta', detail: `+${agentDelta} agent(s)`, severity: 'medium' })
  }
  if (regionSize > 8) {
    factors.push({ kind: 'blast-radius', detail: `${regionSize} entities in region`, severity: 'high' })
  }
  if (confidence === 'none') {
    factors.push({ kind: 'evidence', detail: 'no shadow observations', severity: 'high' })
  } else if (confidence === 'simulated') {
    factors.push({ kind: 'evidence', detail: 'simulated shadow only', severity: 'medium' })
  }

  const tokens = shadow?.observations?.tokens
  if (tokens && tokens.state === 'known' && Number.isFinite(config.budgets.maxTokens)) {
    if (tokens.value > config.budgets.maxTokens) {
      factors.push({ kind: 'budget', detail: 'estimated tokens exceed budget', severity: 'high' })
    }
  } else if (tokens && tokens.state === 'unknown') {
    factors.push({ kind: 'budget', detail: 'token cost unknown', severity: 'high' })
  }

  let level = 'low'
  for (const factor of factors) {
    if (SEVERITY_ORDER[factor.severity] > SEVERITY_ORDER[level]) level = factor.severity
  }
  if (confidence === 'none') level = 'high'

  const autoApplyAllowed =
    level === 'low' &&
    confidence === 'observed-limited' &&
    config.autoApply === true

  const requiresApproval = level !== 'low' || confidence !== 'observed-limited'

  return {
    level,
    factors,
    requiresApproval,
    autoApplyAllowed,
    reason: factors.length === 0 ? 'no risk factors' : factors.map((factor) => factor.kind).join(', '),
  }
}

export function canAutoApply(risk, config) {
  return risk.autoApplyAllowed === true && config.autoApply === true
}
