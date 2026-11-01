/**
 * Multi-objective scoring and selection.
 * Normalized utility is a decision aid, not an experimentally validated metric.
 */
import { round } from './model.js'

const DIMENSIONS = [
  { key: 'quality', source: 'observations', higherBetter: true },
  { key: 'latencyMs', source: 'observations', higherBetter: false },
  { key: 'tokens', source: 'observations', higherBetter: false },
  { key: 'riskEvents', source: 'observations', higherBetter: false },
  { key: 'reconfigCost', source: 'reconfig', higherBetter: false },
]

function observationValue(shadow, key) {
  const obs = shadow?.observations?.[key]
  return obs && obs.state === 'known' && Number.isFinite(obs.value) ? obs.value : null
}

function reconfigValue(candidate) {
  return Number.isFinite(candidate.heuristic?.agentDelta) ? candidate.heuristic.agentDelta : 0
}

function normalize(values, higherBetter) {
  const finite = values.filter((value) => value !== null && Number.isFinite(value))
  if (finite.length === 0) return values.map(() => null)
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  return values.map((value) => {
    if (value === null || !Number.isFinite(value)) return null
    if (max === min) return 0.5
    return higherBetter ? (value - min) / (max - min) : (max - value) / (max - min)
  })
}

/**
 * @param {{candidates: object[], shadows: object[], baseline: object, config: object}} input
 */
export function scoreCandidates(input) {
  const { candidates, shadows, baseline, config } = input
  const shadowById = new Map(shadows.map((shadow) => [shadow.candidateId, shadow]))
  const raw = candidates.map((candidate) => {
    const shadow = shadowById.get(candidate.id)
    return {
      candidate,
      shadow,
      quality: observationValue(shadow, 'quality'),
      latencyMs: observationValue(shadow, 'latencyMs'),
      tokens: observationValue(shadow, 'tokens'),
      riskEvents: observationValue(shadow, 'riskEvents'),
      reconfigCost: reconfigValue(candidate),
    }
  })

  const baselineRaw = {
    quality: Number.isFinite(baseline?.quality) ? baseline.quality : null,
    latencyMs: Number.isFinite(baseline?.latencyMs) ? baseline.latencyMs : null,
    tokens: Number.isFinite(baseline?.tokens) ? baseline.tokens : null,
    riskEvents: Number.isFinite(baseline?.riskEvents) ? baseline.riskEvents : null,
    reconfigCost: 0,
  }

  const normalizedRows = raw.map((row) => ({ ...row }))
  const baselineNorms = {}
  for (const dimension of DIMENSIONS) {
    const values = raw.map((row) => row[dimension.key])
    const baselineValue = baselineRaw[dimension.key]
    const all = [...values, baselineValue]
    const norm = normalize(all, dimension.higherBetter)
    normalizedRows.forEach((row, index) => {
      row[`${dimension.key}Norm`] = norm[index]
    })
    baselineNorms[dimension.key] = norm[norm.length - 1]
  }

  const weights = config.weights
  const weightMap = {
    quality: weights.quality,
    latencyMs: weights.latency,
    tokens: weights.tokens,
    riskEvents: weights.risk,
    reconfigCost: weights.reconfig,
  }

  const scored = normalizedRows.map((row) => {
    let weighted = 0
    let weightSum = 0
    for (const dimension of DIMENSIONS) {
      const value = row[`${dimension.key}Norm`]
      if (value === null || value === undefined) continue
      const weight = weightMap[dimension.key] ?? 0
      weighted += value * weight
      weightSum += weight
    }
    const utility = weightSum > 0 ? weighted / weightSum : 0
    return {
      candidateId: row.candidate.id,
      candidate: row.candidate,
      shadow: row.shadow,
      utility: round(utility),
      normalized: {
        quality: row.qualityNorm,
        latency: row.latencyMsNorm,
        tokens: row.tokensNorm,
        risk: row.riskEventsNorm,
        reconfig: row.reconfigCostNorm,
      },
      raw: {
        quality: row.quality,
        latencyMs: row.latencyMs,
        tokens: row.tokens,
        riskEvents: row.riskEvents,
      },
      pareto: false,
      confidence: row.shadow?.confidence ?? 'none',
    }
  })

  for (const row of scored) row.pareto = isPareto(row, scored)

  const baselineScored = baselineUtility(baselineNorms, weightMap)
  scored.sort((a, b) => {
    if (b.utility !== a.utility) return b.utility - a.utility
    return a.candidateId.localeCompare(b.candidateId)
  })

  const best = scored[0] ?? null
  const delta = best && Number.isFinite(baselineScored)
    ? best.utility - baselineScored
    : null
  const inconclusive = !best ||
    best.confidence === 'none' ||
    isTinyImprovement(best, baselineRaw, config.thresholds.inconclusiveDelta)

  return {
    scored,
    best,
    baselineUtility: Number.isFinite(baselineScored) ? round(baselineScored) : null,
    delta: delta === null ? null : round(delta),
    inconclusive,
  }
}

function baselineUtility(norm, weightMap) {
  let weighted = 0
  let weightSum = 0
  for (const dimension of DIMENSIONS) {
    const value = norm?.[dimension.key]
    if (value === null || value === undefined) continue
    const weight = weightMap[dimension.key] ?? 0
    weighted += value * weight
    weightSum += weight
  }
  return weightSum > 0 ? weighted / weightSum : NaN
}

/**
 * Compare raw best values against the baseline. A change is inconclusive when
 * quality, latency, tokens and risk events all fail to clear the threshold.
 */
function isTinyImprovement(best, baseline, threshold) {
  const raw = best.raw ?? {}
  const improvements = []
  if (Number.isFinite(raw.quality) && Number.isFinite(baseline.quality)) {
    improvements.push(raw.quality - baseline.quality)
  }
  if (Number.isFinite(raw.latencyMs) && Number.isFinite(baseline.latencyMs) && baseline.latencyMs > 0) {
    improvements.push((baseline.latencyMs - raw.latencyMs) / baseline.latencyMs)
  }
  if (Number.isFinite(raw.tokens) && Number.isFinite(baseline.tokens) && baseline.tokens > 0) {
    improvements.push((baseline.tokens - raw.tokens) / baseline.tokens)
  }
  if (Number.isFinite(raw.riskEvents) && Number.isFinite(baseline.riskEvents) && baseline.riskEvents > 0) {
    improvements.push((baseline.riskEvents - raw.riskEvents) / baseline.riskEvents)
  }
  if (improvements.length === 0) return true
  return Math.max(...improvements) < threshold
}

function isPareto(row, all) {
  const dims = DIMENSIONS.map((dimension) => `${dimension.key}Norm`)
  for (const other of all) {
    if (other === row) continue
    let ge = true
    let gt = false
    for (const dim of dims) {
      const a = row[dim]
      const b = other[dim]
      if (a === null || a === undefined || b === null || b === undefined) {
        ge = false
        break
      }
      if (b < a) { ge = false; break }
      if (b > a) gt = true
    }
    if (ge && gt) return false
  }
  return true
}

export { DIMENSIONS }
