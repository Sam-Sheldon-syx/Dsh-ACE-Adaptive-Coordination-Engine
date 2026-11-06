/**
 * P6 self-test: run the real DSH trace through the ACE core inside the Host
 * process, exercise a sandboxed ChangeSet rollback, and write bounded evidence.
 *
 * It reads a session through DSH services; it never writes session state.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { readDshSession, mapDshEvents, getService, resolveSessionId, capabilities } from './trace.js'

function lastSeq(events) {
  let max = -1
  for (const event of events ?? []) {
    if (Number.isInteger(event.seq) && event.seq > max) max = event.seq
  }
  return max
}

function summarizeAnalysis(analysis) {
  return {
    runId: analysis?.runId ?? null,
    trace: analysis?.trace ?? null,
    anomalies: (analysis?.anomalies ?? []).map((entry) => ({
      entity: entry.entity,
      score: entry.score,
      hardRule: entry.hardRule,
    })),
    impactRegion: analysis?.impactRegion
      ? {
          tasks: analysis.impactRegion.tasks?.length ?? 0,
          agents: analysis.impactRegion.agents?.length ?? 0,
          truncated: analysis.impactRegion.truncated,
        }
      : null,
    candidates: (analysis?.candidates ?? []).map((candidate) => ({
      id: candidate.id,
      actions: candidate.actions,
    })),
    decision: analysis?.decision ?? null,
    risk: analysis?.risk
      ? { level: analysis.risk.level, requiresApproval: analysis.risk.requiresApproval }
      : null,
    scoring: analysis?.scoring ?? null,
  }
}

async function rollbackTest(core, topology, analysis) {
  if (!topology.tasks?.length) return { tested: false, reason: 'no tasks' }
  const region = core.impactRegion(topology, (analysis?.anomalies ?? []).slice(0, 4).map((entry) => entry.entity), {
    maxHops: 1,
    maxNodes: 12,
  })
  let candidates = core.generateCandidates(topology, region, core.mergeConfig())
  if (candidates.length === 0) {
    const taskId = topology.tasks[0].id
    candidates = [{
      id: 'synthetic-retry',
      baseVersion: topology.version,
      actions: [{ kind: 'retry-policy', taskId, policy: { maxRetries: 1 } }],
      heuristic: { agentDelta: 0 },
      confidence: 'none',
    }]
  }
  const candidate = candidates[0]
  const changeSet = core.createChangeSet({ candidate, baseTopology: topology, clock: () => '2026-11-01T00:00:00.000Z' })
  let sandbox = core.clone(topology)
  const directions = []
  const execute = async ({ step, direction }) => {
    directions.push(direction)
    sandbox = direction === 'apply'
      ? core.applyAction(sandbox, step.action)
      : core.applyAction(sandbox, step.inverse)
  }

  const failed = await core.applyChangeSet({
    changeSet,
    execute,
    verify: async () => false,
    clock: () => '2026-11-01T00:00:00.000Z',
  })

  return {
    tested: true,
    candidateId: candidate.id,
    actions: candidate.actions.length,
    result: failed.ok ? 'unexpected-commit' : failed.error?.code ?? 'unknown',
    status: failed.changeSet.status,
    restored: sandbox.hash === core.topologyHash(topology),
    directions,
  }
}

async function successApplyTest(core, topology, analysis) {
  if (!topology.tasks?.length) return { tested: false, reason: 'no tasks' }
  const region = core.impactRegion(topology, (analysis?.anomalies ?? []).slice(0, 2).map((entry) => entry.entity), {
    maxHops: 1,
    maxNodes: 8,
  })
  const candidates = core.generateCandidates(topology, region, core.mergeConfig())
  if (candidates.length === 0) return { tested: false, reason: 'no candidate' }
  const candidate = candidates[0]
  const changeSet = core.createChangeSet({ candidate, baseTopology: topology, clock: () => '2026-11-01T00:00:00.000Z' })
  let sandbox = core.clone(topology)
  const result = await core.applyChangeSet({
    changeSet,
    execute: async ({ step, direction }) => {
      sandbox = direction === 'apply'
        ? core.applyAction(sandbox, step.action)
        : core.applyAction(sandbox, step.inverse)
    },
    verify: async () => true,
    clock: () => '2026-11-01T00:00:00.000Z',
  })
  return {
    tested: true,
    candidateId: candidate.id,
    result: result.ok ? 'committed' : result.error?.code ?? 'unknown',
    status: result.changeSet.status,
    targetHashMatches: result.ok ? sandbox.hash === changeSet.targetTopologyHash : false,
  }
}

async function prefixHash(core, events, maxSeq) {
  const prefix = (events ?? []).filter((event) => Number.isInteger(event.seq) && event.seq <= maxSeq)
  return core.hashOf(prefix)
}

/**
 * @param {{ctx: object, config: object, core: object}} input
 */
export async function runSelfTest(input) {
  const { ctx, config, core } = input
  const evidence = {
    plugin: 'ace-plugin',
    stage: config.stage ?? 'public',
    at: new Date().toISOString(),
    sessionId: await resolveSessionId(ctx, config),
    traceSource: null,
    capabilities: capabilities(ctx),
    trace: null,
    analysis: null,
    rollback: null,
    successApply: null,
    sessionConsistency: null,
    errors: [],
  }

  try {
    if (!evidence.sessionId) throw new Error('no live DSH session could be resolved; set sessionId')
    const persistence = getService(ctx, 'sessionPersistence')
    const before = await readDshSession(ctx, evidence.sessionId)
    evidence.traceSource = before.source
    const beforeSeq = lastSeq(before.events)
    const prefixBefore = await prefixHash(core, before.events, beforeSeq)

    let liveAgentIds = []
    try {
      const agentService = getService(ctx, 'agents')
      if (agentService && typeof agentService.list === 'function') {
        const live = await agentService.list()
        liveAgentIds = (live ?? [])
          // Only this session's Agents may enter this session's topology: the
          // Host also runs other sessions' Agents, and admitting them exceeds
          // the topology's maxAgents budget.
          .filter((item) => item?.session?.id === evidence.sessionId)
          .map((item) => item?.id ?? item?.agent?.id)
          .filter(Boolean)
      }
    } catch {
      liveAgentIds = []
    }
    const mapped = mapDshEvents(before.events, { sessionId: evidence.sessionId, liveAgentIds })
    evidence.trace = {
      ...mapped.stats,
      firstSeq: before.events[0]?.seq ?? null,
      lastSeq: beforeSeq,
    }

    const analysis = await core.analyze({
      events: mapped.events,
      topology: mapped.topology,
      sessionId: evidence.sessionId,
      config: config.analysisConfig ?? {},
    })
    evidence.analysis = summarizeAnalysis(analysis)
    evidence.rollback = await rollbackTest(core, mapped.topology, analysis)
    evidence.successApply = await successApplyTest(core, mapped.topology, analysis)

    const after = await readDshSession(
      persistence ? { sessionPersistence: persistence } : ctx,
      evidence.sessionId,
    )
    const afterSeq = lastSeq(after.events)
    const prefixAfter = await prefixHash(core, after.events, beforeSeq)
    evidence.sessionConsistency = {
      beforeSeq,
      afterSeq,
      liveGrowth: afterSeq - beforeSeq,
      prefixHashBefore: prefixBefore,
      prefixHashAfter: prefixAfter,
      unchangedPrefix: prefixBefore === prefixAfter,
    }

    // Persist a bounded run record; no raw conversation text.
    const store = config.stateDir ? new (await import('./state.js')).JsonlStore(config.stateDir) : null
    if (store) {
      store.append('ace-runs.jsonl', {
        at: evidence.at,
        sessionId: evidence.sessionId,
        runId: evidence.analysis?.runId,
        decision: evidence.analysis?.decision?.kind,
        anomalies: evidence.analysis?.anomalies?.length ?? 0,
        candidates: evidence.analysis?.candidates?.length ?? 0,
        rollback: evidence.rollback?.result,
        unchangedPrefix: evidence.sessionConsistency.unchangedPrefix,
      })
    }
  } catch (error) {
    evidence.errors.push({
      code: error?.code ?? 'SELFTEST_ERROR',
      message: String(error?.message ?? error),
    })
  }

  if (config.evidenceFile) {
    try {
      mkdirSync(dirname(config.evidenceFile), { recursive: true })
      writeFileSync(config.evidenceFile, JSON.stringify(evidence, null, 2) + '\n')
    } catch (error) {
      evidence.errors.push({ code: 'EVIDENCE_WRITE_FAILED', message: String(error?.message ?? error) })
    }
  }

  return evidence
}
