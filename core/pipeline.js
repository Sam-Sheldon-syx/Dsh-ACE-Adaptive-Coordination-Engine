/**
 * ACE analysis pipeline: trace → anomaly → impact region → candidates →
 * shadow → scoring → risk → decision. Pure orchestration; no execution.
 */
import { mergeConfig } from './config.js'
import { hashOf, round } from './model.js'
import { normalizeTrace, replayTrace } from './trace.js'
import { buildTopology, impactRegion, topologyStats } from './graph.js'
import { detectAnomalies } from './anomaly.js'
import { generateCandidates } from './topology.js'
import { baselineFromTrace, simulateCandidate } from './shadow.js'
import { scoreCandidates } from './scoring.js'
import { assessRisk } from './risk.js'

/**
 * @param {{
 *   events?: object[],
 *   traceOptions?: object,
 *   topology?: object,
 *   sessionId?: string,
 *   config?: object,
 *   shadowRunner?: object,
 *   now?: string,
 * }} input
 */
export async function analyze(input = {}) {
  const config = mergeConfig(input.config ?? {})
  const trace = normalizeTrace(input.events ?? [], input.traceOptions ?? {})
  const topology = buildTopology(trace, {
    sessionId: input.sessionId ?? 'synthetic',
    seedTopology: input.topology,
  })

  const detection = detectAnomalies(trace, config)
  const region = impactRegion(topology, detection.seeds, {
    maxHops: config.maxHops,
    maxNodes: config.regionMaxNodes,
  })
  const candidates = generateCandidates(topology, region, config, trace.metrics)
  const baseline = baselineFromTrace(trace)

  const shadowRuns = []
  for (const candidate of candidates) {
    try {
      const result = await simulateCandidate({
        candidate,
        baseline,
        config,
        mode: config.shadowMode,
        runner: input.shadowRunner,
      })
      shadowRuns.push(result)
    } catch (error) {
      shadowRuns.push({
        runId: `shadow-failed-${candidate.id}`,
        candidateId: candidate.id,
        mode: config.shadowMode,
        observations: {
          quality: { state: 'unknown', reason: 'shadow failed' },
          latencyMs: { state: 'unknown', reason: 'shadow failed' },
          tokens: { state: 'unknown', reason: 'shadow failed' },
          riskEvents: { state: 'unknown', reason: 'shadow failed' },
          confidence: 'none',
        },
        confidence: 'none',
        verdict: 'failed',
        failure: { code: error?.code ?? 'SHADOW_FAILED', message: String(error?.message ?? error) },
        evidence: [],
      })
    }
  }

  const scoring = candidates.length > 0
    ? scoreCandidates({ candidates, shadows: shadowRuns, baseline, config })
    : { scored: [], best: null, baselineUtility: null, delta: null, inconclusive: true }

  let risk = null
  let decision
  if (candidates.length === 0) {
    decision = { kind: 'no-op', reason: 'no-candidate' }
  } else if (!scoring.best || scoring.inconclusive) {
    decision = { kind: 'no-op', reason: 'inconclusive' }
  } else {
    risk = assessRisk({
      candidate: scoring.best.candidate,
      region,
      config,
      shadow: scoring.best.shadow,
    })
    if (config.autoApply && risk.autoApplyAllowed) {
      decision = { kind: 'apply', candidateId: scoring.best.candidateId, risk }
    } else if (risk.requiresApproval) {
      decision = {
        kind: 'request-approval',
        candidateId: scoring.best.candidateId,
        risk,
        summary: `candidate ${scoring.best.candidateId} utility=${scoring.best.utility} risk=${risk.level}`,
      }
    } else {
      decision = { kind: 'report-only', reason: 'autoApply disabled' }
    }
  }

  const lastEvent = trace.window.count > 0 && input.events?.length
    ? input.events[input.events.length - 1].time
    : null
  const createdAt = lastEvent ?? input.now ?? null

  const runIdHash = hashOf({
    sessionId: topology.sessionId,
    window: trace.window,
    topology: topology.hash,
    anomalies: detection.anomalies,
    candidates: candidates.map((candidate) => candidate.id),
    decision,
  })

  return {
    runId: `run-${runIdHash.slice(0, 16)}`,
    sessionId: topology.sessionId,
    trigger: 'analysis',
    createdAt,
    trace: replayTrace(trace),
    topology: {
      hash: topology.hash,
      version: topology.version,
      stats: topologyStats(topology),
    },
    anomalies: detection.anomalies,
    impactRegion: region,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      baseVersion: candidate.baseVersion,
      actions: candidate.actions,
      heuristic: candidate.heuristic,
      confidence: candidate.confidence,
    })),
    shadowRuns,
    scoring: {
      scored: scoring.scored.map((row) => ({
        candidateId: row.candidateId,
        utility: round(row.utility),
        normalized: row.normalized,
        pareto: row.pareto,
        confidence: row.confidence,
      })),
      best: scoring.best ? scoring.best.candidateId : null,
      baselineUtility: scoring.baselineUtility,
      delta: scoring.delta,
      inconclusive: scoring.inconclusive,
    },
    risk,
    decision,
    outcome: 'reported',
    confidence: trace.window.confidence,
    evidence: [
      { kind: 'session-event', ref: `window:${trace.window.fromSeq}-${trace.window.toSeqExclusive}` },
    ],
  }
}
