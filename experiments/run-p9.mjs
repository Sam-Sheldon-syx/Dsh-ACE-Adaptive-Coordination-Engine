/**
 * P9 offline replay experiment.
 *
 * The corpus is deterministic and semi-synthetic: task graphs and event shapes
 * mirror the adapter's trace model, with injected faults at known targets.
 * It does NOT measure real DSH multi-agent task quality or end-to-end effect.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { analyze } from '../core/pipeline.js'
import { normalizeTrace } from '../core/trace.js'
import { hashOf } from '../core/model.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'experiments', 'results')

const REPEATS = 3
const PER_TYPE = 12
const FAULT_TYPES = ['failure', 'retry', 'stall', 'tokenSpike', 'timeout', 'mixed']
const TYPES = ['clean', ...FAULT_TYPES]

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function quantile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index]
}

function bootstrapCI(values, resamples = 1000, seed = 20261101) {
  if (values.length === 0) return null
  const rng = mulberry32(seed)
  const means = []
  for (let i = 0; i < resamples; i += 1) {
    let sum = 0
    for (let j = 0; j < values.length; j += 1) {
      sum += values[Math.floor(rng() * values.length)]
    }
    means.push(sum / values.length)
  }
  return {
    mean: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4)),
    ci95: [Number(quantile(means, 0.025).toFixed(4)), Number(quantile(means, 0.975).toFixed(4))],
  }
}

function makeScenario(type, index) {
  const target = type === 'clean' ? null : (index % 2 === 0 ? 't2' : 't3')
  const t0 = Date.parse('2026-11-01T00:00:00.000Z') + index * 120000
  const events = []
  const push = (eventType, data, timeMs) => {
    events.push({ type: eventType, data, time: new Date(timeMs).toISOString() })
  }

  push('team/member', { agentId: 'a1', kind: 'teammate' }, t0)
  push('team/member', { agentId: 'a2', kind: 'teammate' }, t0 + 1)
  for (let i = 0; i < 4; i += 1) {
    push('team/task', {
      taskId: `t${i + 1}`,
      status: 'running',
      dependsOn: i === 0 ? [] : ['t1'],
      assignee: i % 2 === 0 ? 'a1' : 'a2',
      criticality: 'medium',
    }, t0 + 10 + i)
  }

  for (let i = 0; i < 4; i += 1) {
    const taskId = `t${i + 1}`
    const agentId = i % 2 === 0 ? 'a1' : 'a2'
    const start = t0 + 1000 + i * 2000
    const callId = `call-${index}-${i}`
    const isFaultTarget = target === taskId
    const failure = isFaultTarget && (type === 'failure' || type === 'mixed')
    const stall = isFaultTarget && type === 'stall'
    const timeout = isFaultTarget && type === 'timeout'
    const tokenSpike = isFaultTarget && (type === 'tokenSpike' || type === 'mixed')
    const retry = isFaultTarget && (type === 'retry' || type === 'mixed')

    push('step/start', { taskId, agentId }, start)
    push('tool/call', { taskId, agentId, callId, name: 'bash' }, start + 10)
    if (!stall) {
      push('tool/result', { taskId, agentId, callId, isError: failure }, start + 30)
    }
    const duration = timeout ? 600000 : 100
    push('step/end', { taskId, agentId }, start + duration)
    const tokens = tokenSpike ? 100000 : 50
    push('assistant/message', { taskId, agentId, tokens, usage: { totalTokens: tokens } }, start + duration)
    if (retry) {
      for (let r = 0; r < 3; r += 1) {
        push('llm/retry', { taskId, agentId }, start + duration + 1 + r)
      }
    }
  }

  events.forEach((event, seq) => { event.seq = seq })
  return {
    id: `p9-${type}-${String(index).padStart(2, '0')}`,
    type,
    target,
    events,
  }
}

function hardRuleBaseline(events) {
  const trace = normalizeTrace(events)
  const flagged = []
  for (const [id, metrics] of Object.entries(trace.metrics.tasks)) {
    if ((metrics.failures ?? 0) > 0 || (metrics.retries ?? 0) >= 3 || (metrics.unresolvedCalls ?? 0) > 0) {
      flagged.push(id)
    }
  }
  return { flagged, candidates: 0, decision: 'no-op' }
}

function rowFor({ scenario, baseline, repeat, flagged, candidates, decision, runtimeMs }) {
  return {
    scenarioId: scenario.id,
    type: scenario.type,
    target: scenario.target,
    baseline,
    repeat,
    flagged,
    detectedTarget: scenario.target === null ? null : flagged.includes(scenario.target),
    falsePositiveTasks: scenario.target === null ? flagged.length : flagged.filter((id) => id !== scenario.target).length,
    candidateCount: candidates,
    decision,
    runtimeMs: Number(runtimeMs.toFixed(4)),
  }
}

function summarize(rows, scenarios) {
  const faultScenarios = scenarios.filter((scenario) => scenario.type !== 'clean')
  const cleanScenarios = scenarios.filter((scenario) => scenario.type === 'clean')
  const byBaseline = new Map()

  for (const baseline of ['b0-noop', 'b1-hardrule', 'ace']) {
    const baseRows = rows.filter((row) => row.baseline === baseline && row.repeat === 0)
    const map = new Map(baseRows.map((row) => [row.scenarioId, row]))
    const faultRows = faultScenarios.map((scenario) => map.get(scenario.id)).filter(Boolean)
    const cleanRows = cleanScenarios.map((scenario) => map.get(scenario.id)).filter(Boolean)
    const tp = faultRows.filter((row) => row.detectedTarget === true).length
    const fp = cleanRows.filter((row) => (row.flagged?.length ?? 0) > 0).length
    const recallValues = faultScenarios.map((scenario) => (map.get(scenario.id)?.detectedTarget ? 1 : 0))
    const agreementValues = [
      ...faultRows.map((row) => (row.decision !== 'no-op' ? 1 : 0)),
      ...cleanRows.map((row) => (row.decision === 'no-op' ? 1 : 0)),
    ]
    const candidateValues = faultRows.map((row) => (row.candidateCount > 0 ? 1 : 0))
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
    const recall = faultScenarios.length === 0 ? 0 : tp / faultScenarios.length
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
    const times = rows.filter((row) => row.baseline === baseline).map((row) => row.runtimeMs)
    byBaseline.set(baseline, {
      scenarios: baseRows.length,
      truePositives: tp,
      falsePositiveScenarios: fp,
      recall,
      precision,
      f1,
      recallBootstrap: bootstrapCI(recallValues),
      decisionAgreement: agreementValues.length === 0 ? 0 : agreementValues.reduce((a, b) => a + b, 0) / agreementValues.length,
      decisionAgreementBootstrap: bootstrapCI(agreementValues),
      candidateRate: candidateValues.length === 0 ? 0 : candidateValues.reduce((a, b) => a + b, 0) / candidateValues.length,
      runtime: {
        samples: times.length,
        medianMs: Number(quantile(times, 0.5).toFixed(4)),
        p95Ms: Number(quantile(times, 0.95).toFixed(4)),
        minMs: Number(Math.min(...times).toFixed(4)),
        maxMs: Number(Math.max(...times).toFixed(4)),
      },
    })
  }

  const hardTypes = new Set(['failure', 'retry', 'stall', 'mixed'])
  const softTypes = new Set(['tokenSpike', 'timeout'])
  const recallByType = {}
  for (const type of FAULT_TYPES) {
    const subset = scenarios.filter((scenario) => scenario.type === type)
    recallByType[type] = {}
    for (const baseline of ['b0-noop', 'b1-hardrule', 'ace']) {
      const baseRows = rows.filter((row) => row.baseline === baseline && row.repeat === 0)
      const map = new Map(baseRows.map((row) => [row.scenarioId, row]))
      recallByType[type][baseline] = subset.length === 0
        ? 0
        : subset.filter((scenario) => map.get(scenario.id)?.detectedTarget === true).length / subset.length
    }
  }

  return {
    scenarios: scenarios.length,
    faultScenarios: faultScenarios.length,
    cleanScenarios: cleanScenarios.length,
    repeats: REPEATS,
    baselines: Object.fromEntries(byBaseline),
    recallByType,
    hardTypeRecall: {
      b0: 0,
      b1: average(FAULT_TYPES.filter((t) => hardTypes.has(t)).map((t) => recallByType[t]['b1-hardrule'])),
      ace: average(FAULT_TYPES.filter((t) => hardTypes.has(t)).map((t) => recallByType[t].ace)),
    },
    softTypeRecall: {
      b0: 0,
      b1: average(FAULT_TYPES.filter((t) => softTypes.has(t)).map((t) => recallByType[t]['b1-hardrule'])),
      ace: average(FAULT_TYPES.filter((t) => softTypes.has(t)).map((t) => recallByType[t].ace)),
    },
  }
}

function average(values) {
  return values.length === 0 ? 0 : Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4))
}

async function main() {
  const scenarios = []
  for (const type of TYPES) {
    for (let index = 0; index < PER_TYPE; index += 1) {
      scenarios.push(makeScenario(type, index))
    }
  }

  const rows = []
  for (const scenario of scenarios) {
    const b0 = { flagged: [], candidates: 0, decision: 'no-op' }
    rows.push(rowFor({ scenario, baseline: 'b0-noop', repeat: 0, ...b0, runtimeMs: 0 }))

    const b1 = hardRuleBaseline(scenario.events)
    rows.push(rowFor({ scenario, baseline: 'b1-hardrule', repeat: 0, ...b1, runtimeMs: 0 }))

    for (let repeat = 0; repeat < REPEATS; repeat += 1) {
      const started = performance.now()
      const run = await analyze({ events: scenario.events })
      const elapsed = performance.now() - started
      const flagged = run.anomalies
        .filter((entry) => entry.entity.kind === 'task')
        .map((entry) => entry.entity.id)
      rows.push(rowFor({
        scenario,
        baseline: 'ace',
        repeat,
        flagged,
        candidates: run.candidates.length,
        decision: run.decision.kind,
        runtimeMs: elapsed,
      }))
    }
  }

  const summary = {
    meta: {
      stage: 'P9',
      generatedAt: new Date().toISOString(),
      command: 'node experiments/run-p9.mjs',
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      corpus: 'semi-synthetic deterministic task graphs with injected faults',
      corpusHash: hashOf(scenarios.map((scenario) => ({ id: scenario.id, type: scenario.type, target: scenario.target }))),
      scenarios: scenarios.length,
      faultTypes: FAULT_TYPES,
      cleanType: 'clean',
      perType: PER_TYPE,
      repeats: REPEATS,
      note: 'Synthetic fault labels; not real DSH multi-agent task quality or end-to-end effect.',
    },
    results: summarize(rows, scenarios),
    caveats: [
      'Synthetic task graphs; not real Python engineering tasks.',
      'No real DSH state application/rollback; decision quality is measured only as non-noop vs noop.',
      'No statistical significance claim; bootstrap intervals describe this fixed corpus.',
      'Runtime measured in one local process; not a production performance claim.',
    ],
  }

  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'p9-raw.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
  writeFileSync(join(outDir, 'p9-summary.json'), JSON.stringify(summary, null, 2) + '\n')
  const header = 'scenarioId,type,target,baseline,repeat,detectedTarget,falsePositiveTasks,candidateCount,decision,runtimeMs'
  const lines = rows.map((row) => [
    row.scenarioId, row.type, row.target ?? '', row.baseline, row.repeat,
    row.detectedTarget, row.falsePositiveTasks, row.candidateCount, row.decision, row.runtimeMs,
  ].join(','))
  writeFileSync(join(outDir, 'p9-raw.csv'), [header, ...lines].join('\n') + '\n')

  console.log(JSON.stringify({
    scenarios: summary.meta.scenarios,
    faultScenarios: summary.results.faultScenarios,
    baselines: summary.results.baselines,
    hardTypeRecall: summary.results.hardTypeRecall,
    softTypeRecall: summary.results.softTypeRecall,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
