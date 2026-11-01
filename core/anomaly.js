/**
 * Anomaly detection over a normalized trace.
 *
 * The scoring formula is an initial, uncalibrated heuristic. It must not be
 * presented as a validated detector before P9.
 */
import { clamp, median, mad, round } from './model.js'

function robustZ(value, values, zMax) {
  const med = median(values)
  const deviation = mad(values)
  if (med === null || deviation === null) return 0
  if (deviation === 0) return value > med ? zMax : 0
  return clamp((value - med) / (1.4826 * deviation), 0, zMax)
}

const TASK_METRICS = [
  { key: 'failures', weightKey: 'failures' },
  { key: 'retries', weightKey: 'retries' },
  { key: 'latencyMs', weightKey: 'latency' },
  { key: 'tokens', weightKey: 'tokens' },
  { key: 'unresolvedCalls', weightKey: 'stalls' },
]

const AGENT_METRICS = [
  { key: 'failures', weightKey: 'failures' },
  { key: 'retries', weightKey: 'retries' },
  { key: 'latencyMs', weightKey: 'latency' },
  { key: 'tokens', weightKey: 'tokens' },
  { key: 'messages', weightKey: 'coordination' },
]

/**
 * @param {object} trace normalized trace
 * @param {object} config merged ACE config
 */
export function detectAnomalies(trace, config) {
  const zMax = config.thresholds.zMax
  const weights = config.signalWeights
  const results = []

  scoreEntities('task', trace.metrics?.tasks ?? {}, TASK_METRICS, weights, zMax, config, results)
  scoreEntities('agent', trace.metrics?.agents ?? {}, AGENT_METRICS, weights, zMax, config, results)

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return `${a.entity.kind}:${a.entity.id}`.localeCompare(`${b.entity.kind}:${b.entity.id}`)
  })

  const threshold = config.thresholds.anomaly
  const anomalies = results.filter((entry) => entry.hardRule || entry.score >= threshold)
  return {
    anomalies,
    seeds: anomalies.map((entry) => entry.entity),
    allScores: results,
  }
}

function scoreEntities(kind, metricsMap, metricDefs, weights, zMax, config, out) {
  const entries = Object.entries(metricsMap)
  if (entries.length === 0) return
  const columns = {}
  for (const metric of metricDefs) {
    columns[metric.key] = entries
      .map(([, value]) => Number(value[metric.key] ?? 0))
      .filter((value) => Number.isFinite(value))
  }

  for (const [id, metrics] of entries) {
    const signals = []
    let score = 0
    for (const metric of metricDefs) {
      const value = Number(metrics[metric.key] ?? 0)
      if (!Number.isFinite(value)) continue
      const z = robustZ(value, columns[metric.key], zMax)
      if (z <= 0) continue
      const contribution = z * (weights[metric.weightKey] ?? 0)
      score += contribution
      signals.push({
        kind: metric.key,
        score: round(contribution),
        evidence: [{ kind: 'session-event', ref: `${kind}:${id}:${metric.key}` }],
      })
    }

    let hardRule = false
    if (kind === 'task' && config.hardRules.failure && (metrics.failures ?? 0) > 0) {
      hardRule = true
      signals.push({
        kind: 'task-failure',
        score: 0,
        evidence: [{ kind: 'session-event', ref: `task:${id}:failures` }],
      })
    }
    if (kind === 'task' && config.hardRules.stalledCall && (metrics.unresolvedCalls ?? 0) > 0) {
      hardRule = true
    }
    if (config.hardRules.retries > 0 && (metrics.retries ?? 0) >= config.hardRules.retries) {
      hardRule = true
      signals.push({
        kind: 'task-retry',
        score: 0,
        evidence: [{ kind: 'session-event', ref: `${kind}:${id}:retries` }],
      })
    }

    out.push({
      entity: { kind, id },
      score: round(score),
      signals,
      hardRule,
    })
  }
}
