/**
 * Runtime status rendering. Pure string builder over bounded evidence.
 * No DSH dependency; the tool adapter calls this in the Host process.
 */

function fmt(value) {
  return value === null || value === undefined ? 'unknown' : String(value)
}

function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${row.map(fmt).join(' | ')} |`).join('\n')
  return [head, sep, body].filter(Boolean).join('\n')
}

/**
 * @param {object} evidence self-test evidence or a compact analysis result
 */
export function renderStatus(evidence) {
  const analysis = evidence?.analysis ?? evidence
  const trace = evidence?.trace ?? analysis?.trace ?? {}
  const decision = analysis?.decision ?? {}
  const risk = { ...(analysis?.risk ?? {}), ...(decision?.risk ?? {}) }
  const lines = []

  lines.push('# ACE Runtime Status')
  lines.push('')
  lines.push(`- Generated: ${fmt(evidence?.at)}`)
  lines.push(`- Session: ${fmt(evidence?.sessionId)}`)
  lines.push(`- Trace source: ${fmt(evidence?.traceSource ?? trace.source)}`)
  lines.push(`- Plugin stage: ${fmt(evidence?.stage ?? 'public')}`)
  lines.push('')

  lines.push('## 1. Capabilities')
  const caps = evidence?.capabilities ?? {}
  lines.push(table(['capability', 'available'], Object.entries(caps).map(([key, value]) => [key, value === true ? 'yes' : 'no'])))
  lines.push('')

  lines.push('## 2. Trace')
  lines.push(table(['metric', 'value'], [
    ['input events', trace.inputEvents ?? trace.eventCount ?? 'unknown'],
    ['mapped events', trace.mappedEvents ?? 'unknown'],
    ['tasks', trace.tasks ?? 'unknown'],
    ['agents', trace.agents ?? analysis?.trace?.agents ?? 'unknown'],
    ['tool calls', trace.toolCalls ?? 'unknown'],
    ['failures', trace.failures ?? 'unknown'],
    ['tokens (summed usage, not billing)', trace.tokens ?? 'unknown'],
    ['latencyMs (may be 0 = not derived)', trace.latencyMs ?? analysis?.trace?.latencyMs ?? 'unknown'],
  ]))
  lines.push('')

  lines.push('## 3. Anomalies')
  const anomalies = analysis?.anomalies ?? []
  if (anomalies.length === 0) lines.push('No anomalies in the observed window.')
  else {
    lines.push(table(['entity', 'score', 'hard rule'], anomalies.map((entry) => [
      `${entry.entity?.kind}:${entry.entity?.id}`,
      entry.score,
      entry.hardRule === true ? 'yes' : 'no',
    ])))
  }
  lines.push('')

  lines.push('## 4. Impact region')
  const region = analysis?.impactRegion
  if (!region) lines.push('Not computed.')
  else lines.push(`- tasks: ${fmt(region.tasks?.length ?? region.tasks)}\n- agents: ${fmt(region.agents?.length ?? region.agents)}\n- truncated: ${fmt(region.truncated)}`)
  lines.push('')

  lines.push('## 5. Candidates')
  const candidates = analysis?.candidates ?? []
  if (candidates.length === 0) lines.push('No feasible candidates.')
  else {
    lines.push(table(['id', 'actions'], candidates.map((candidate) => [
      candidate.id,
      (candidate.actions ?? []).map((action) => action.kind).join(', '),
    ])))
  }
  lines.push('')

  lines.push('## 6. Decision')
  lines.push(table(['field', 'value'], [
    ['kind', decision.kind],
    ['candidate', decision.candidateId],
    ['risk level', risk.level],
    ['requires approval', risk.requiresApproval],
    ['auto apply allowed', risk.autoApplyAllowed],
    ['reason', decision.reason ?? risk.reason],
    ['summary', decision.summary],
  ]))
  lines.push('')

  lines.push('## 6b. Scoring / shadow')
  const scoring = analysis?.scoring
  if (!scoring) lines.push('Not computed.')
  else {
    lines.push(table(['field', 'value'], [
      ['best', scoring.best],
      ['baseline utility', scoring.baselineUtility],
      ['delta', scoring.delta],
      ['inconclusive', scoring.inconclusive],
      ['confidence', scoring.scored?.find((row) => row.candidateId === scoring.best)?.confidence],
    ]))
  }
  lines.push('')

  lines.push('## 7. Rollback / apply verification')
  const rollback = evidence?.rollback
  if (!rollback?.tested) lines.push('Not tested in this run.')
  else {
    lines.push(table(['field', 'value'], [
      ['rollback result', rollback.result],
      ['rollback status', rollback.status],
      ['state restored', rollback.restored],
      ['success apply', evidence?.successApply?.result],
      ['target hash matched', evidence?.successApply?.targetHashMatches],
    ]))
  }
  lines.push('')

  lines.push('## 8. Session consistency')
  const consistency = evidence?.sessionConsistency
  if (!consistency) lines.push('Not measured.')
  else {
    lines.push(table(['field', 'value'], [
      ['before seq', consistency.beforeSeq],
      ['after seq', consistency.afterSeq],
      ['live growth', consistency.liveGrowth],
      ['unchanged prefix', consistency.unchangedPrefix],
    ]))
  }
  lines.push('')

  lines.push('## 9. Tooling')
  const tools = evidence?.tools ?? {}
  lines.push(`- registered: ${(tools.registered ?? []).join(', ') || 'none'}`)
  lines.push(`- error: ${tools.error ?? (tools.registered?.length ? 'none' : 'unknown')}`)
  if (evidence?.toolProbe) {
    lines.push(`- ace_status probe: ${evidence.toolProbe.ok ? 'ok' : 'failed'} (${evidence.toolProbe.length ?? 0} chars)`)
  }
  lines.push('')

  const errors = evidence?.errors ?? []
  if (errors.length > 0) {
    lines.push('## 10. Errors')
    for (const error of errors) lines.push(`- ${error.code}: ${error.message}`)
    lines.push('')
  }

  lines.push('> Read-only status derived from the observed session window. ' +
    'Mode R shadow values are simulated, token sums are not billing, ' +
    'and no real DSH task state was changed by this status.')
  return lines.join('\n')
}

/** Bounded plain summary for tool output / logs. */
export function summarizeStatus(evidence) {
  const analysis = evidence?.analysis ?? evidence
  const decision = analysis?.decision ?? {}
  const risk = { ...(analysis?.risk ?? {}), ...(decision?.risk ?? {}) }
  return {
    sessionId: evidence?.sessionId ?? null,
    trace: {
      events: evidence?.trace?.inputEvents ?? analysis?.trace?.eventCount ?? null,
      tasks: evidence?.trace?.tasks ?? analysis?.trace?.tasks ?? null,
    },
    anomalies: (analysis?.anomalies ?? []).length,
    candidates: (analysis?.candidates ?? []).length,
    decision: decision.kind ?? null,
    risk: risk.level ?? null,
    rollback: evidence?.rollback?.result ?? null,
    unchangedPrefix: evidence?.sessionConsistency?.unchangedPrefix ?? null,
  }
}
