/**
 * Shadow evaluation framework.
 *
 * Mode R (replay) uses a deterministic, explicitly uncertain cost model.
 * It is NOT a measurement of real execution. Mode L (live fork) is only an
 * interface here; P6 wires the DSH adapter and must re-validate every claim.
 */
import { AceError, clamp, clone, hashOf, round } from './model.js'

/**
 * Build a baseline observation set from a normalized trace.
 * @param {object} trace
 */
export function baselineFromTrace(trace) {
  const tasks = Object.values(trace.metrics?.tasks ?? {})
  const attempts = tasks.reduce((sum, task) => sum + (task.attempts ?? 0), 0)
  const failures = tasks.reduce((sum, task) => sum + (task.failures ?? 0), 0)
  const retries = tasks.reduce((sum, task) => sum + (task.retries ?? 0), 0)
  const tokens = tasks.reduce((sum, task) => sum + (task.tokens ?? 0), 0)
  const latencyValues = tasks.map((task) => task.latencyMs).filter((value) => value > 0)
  const latencyMs = latencyValues.length > 0
    ? latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length
    : null
  const quality = attempts > 0 ? 1 - failures / attempts : null
  return {
    quality: quality === null ? null : round(quality),
    latencyMs: latencyMs === null ? null : round(latencyMs),
    tokens: tokens > 0 ? tokens : null,
    riskEvents: failures + retries,
    known: quality !== null,
    source: 'replay-baseline',
  }
}

function baselineOrUnknown(value) {
  return value === null || value === undefined
    ? { state: 'unknown', reason: 'baseline metric unavailable' }
    : { state: 'known', value }
}

/**
 * Simulate one candidate under Mode R.
 * @param {{candidate: object, baseline: object, config: object, mode?: string, runner?: object}} input
 */
export async function simulateCandidate(input) {
  const mode = input.mode ?? 'replay'
  const candidate = input.candidate
  const baseline = input.baseline ?? {}
  const config = input.config

  if (mode === 'off') {
    return {
      runId: `shadow-${(await hashOf({ candidate: candidate.id, mode })).slice(0, 12)}`,
      candidateId: candidate.id,
      mode,
      observations: unknownObservations('shadow disabled'),
      confidence: 'none',
      verdict: 'inconclusive',
      evidence: [],
    }
  }

  if (mode === 'live-fork') {
    if (!input.runner || typeof input.runner.run !== 'function') {
      throw new AceError('SHADOW_UNAVAILABLE', 'live-fork shadow runner is not configured')
    }
    const result = await input.runner.run({ candidate, config })
    return {
      runId: result.runId,
      candidateId: candidate.id,
      mode,
      observations: result.observations,
      confidence: 'observed-limited',
      verdict: result.verdict ?? 'inconclusive',
      evidence: result.evidence ?? [],
    }
  }

  if (mode !== 'replay') {
    throw new AceError('CONFIG_INVALID', `unknown shadow mode: ${mode}`)
  }

  const sim = config.simulation
  let quality = baseline.quality
  let latency = baseline.latencyMs
  let tokens = baseline.tokens
  let riskEvents = baseline.riskEvents
  let qualityDelta = 0
  let latencyFactor = 1
  let tokenFactor = 1
  let riskFactor = 1

  for (const action of candidate.actions ?? []) {
    switch (action.kind) {
      case 'reassign': qualityDelta += sim.reassignQuality; break
      case 'split': qualityDelta += sim.splitQuality; break
      case 'add-helper': qualityDelta += sim.addHelperQuality; break
      case 'rewire': qualityDelta += sim.rewireQuality; break
      case 'retry-policy': qualityDelta += sim.retryQuality; break
      default: break
    }
    latencyFactor *= sim.latencyFactor
    tokenFactor *= sim.tokenFactor
    riskFactor *= sim.riskFactor
  }

  const known = baseline.known !== false
  if (known && quality !== null) quality = clamp(quality + qualityDelta, 0, 1)
  if (known && latency !== null) latency = latency * latencyFactor
  if (known && tokens !== null) tokens = tokens * tokenFactor
  if (known && Number.isFinite(riskEvents)) riskEvents = riskEvents * riskFactor

  const observations = {
    quality: known && quality !== null
      ? { state: 'known', value: round(quality) }
      : { state: 'unknown', reason: 'baseline quality unavailable' },
    latencyMs: known && latency !== null
      ? { state: 'known', value: round(latency, 1) }
      : { state: 'unknown', reason: 'baseline latency unavailable' },
    tokens: known && tokens !== null
      ? { state: 'known', value: round(tokens, 1) }
      : { state: 'unknown', reason: 'baseline tokens unavailable' },
    riskEvents: known && Number.isFinite(riskEvents)
      ? { state: 'known', value: round(riskEvents) }
      : { state: 'unknown', reason: 'baseline risk events unavailable' },
    confidence: 'simulated',
  }

  const qualityDeltaActual = known && quality !== null && baseline.quality !== null
    ? quality - baseline.quality
    : null
  const verdict = qualityDeltaActual === null
    ? 'inconclusive'
    : qualityDeltaActual > sim.uncertainty
      ? 'better'
      : qualityDeltaActual < -sim.uncertainty
        ? 'worse'
        : 'inconclusive'

  return {
    runId: `shadow-${(await hashOf({ candidate: candidate.id, mode, actions: candidate.actions })).slice(0, 12)}`,
    candidateId: candidate.id,
    mode,
    observations,
    confidence: 'simulated',
    verdict,
    evidence: [{ kind: 'shadow-run', ref: `replay:${candidate.id}` }],
    uncertainty: sim.uncertainty,
  }
}

function unknownObservations(reason) {
  return {
    quality: { state: 'unknown', reason },
    latencyMs: { state: 'unknown', reason },
    tokens: { state: 'unknown', reason },
    riskEvents: { state: 'unknown', reason },
    confidence: 'none',
  }
}

/** Copy of a shadow result suitable for an AceRun record. */
export function summarizeShadow(result) {
  return clone(result)
}
