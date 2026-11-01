/**
 * Trace normalization and signal extraction.
 * Input is a read-only window of DSH session events (or synthetic fixtures).
 * This module never writes session state and never imports DSH packages.
 */
import { AceError, assert, clone } from './model.js'

/** Persisted session event types confirmed by P2 (62). */
export const KNOWN_EVENT_TYPES = Object.freeze(new Set([
  'agent-preset/selected', 'agent/inbox/spliced', 'approval/asked', 'approval/decided',
  'approval/policy', 'assistant/attempt', 'assistant/message', 'command/done', 'command/run',
  'compaction/end', 'compaction/prune', 'compaction/start', 'compaction/summary',
  'deliverables/presented', 'developer/message', 'feedback/message-delete',
  'feedback/message-put', 'feedback/record', 'goal/change', 'hook/invoked', 'hook/result',
  'image/offload', 'job/registered', 'job/settled', 'llm/retry', 'llm/retry-started',
  'model/selection', 'permission/preset', 'plan/mode', 'request/context', 'request/header',
  'sandbox/mode', 'schedule/change', 'session-log-deepseek/delivery-accepted',
  'session/end-seed', 'session/title', 'session/title-llm-request', 'step/end', 'step/start',
  'subagent/catalog', 'subagent/descriptor', 'subagent/model-selection-policy',
  'system/message', 'team/member', 'team/message/delivered', 'team/message/queued',
  'team/task', 'todo/write', 'tool-workflow/agent-end', 'tool-workflow/agent-start',
  'tool-workflow/run-end', 'tool-workflow/run-start', 'tool/call', 'tool/ptc-dispatch',
  'tool/ptc-dispatch-start', 'tool/result', 'turn/end', 'turn/start', 'user/message',
  'web/deepseek-search-llm-request', 'working-directory/change', 'workspace/changes',
]))

function emptyTask(id) {
  return {
    id,
    status: 'unknown',
    criticality: 'medium',
    dependsOn: [],
    assignee: null,
    expectedTokens: null,
    expectedMs: null,
    attempts: 0,
    failures: 0,
    retries: 0,
    tokens: 0,
    latencyMs: 0,
    unresolvedCalls: 0,
    messages: 0,
  }
}

function emptyAgent(id) {
  return {
    id,
    kind: 'teammate',
    failures: 0,
    retries: 0,
    tokens: 0,
    latencyMs: 0,
    messages: 0,
  }
}

function ensureTask(map, id) {
  if (!map.has(id)) map.set(id, emptyTask(id))
  return map.get(id)
}

function ensureAgent(map, id) {
  if (!map.has(id)) map.set(id, emptyAgent(id))
  return map.get(id)
}

function parseTime(value) {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Validate and normalize a trace window.
 * @param {Array<object>} events
 * @param {{fromSeq?: number, toSeqExclusive?: number, source?: string, confidence?: string}} [options]
 */
export function normalizeTrace(events, options = {}) {
  assert(Array.isArray(events), 'TRACE_CORRUPT', 'trace events must be an array')
  if (events.length === 0) {
    return {
      window: {
        fromSeq: options.fromSeq ?? 0,
        toSeqExclusive: options.toSeqExclusive ?? 0,
        count: 0,
        truncated: false,
        source: options.source ?? 'live',
        confidence: 'none',
      },
      tasks: [],
      agents: [],
      coordination: [],
      metrics: { tasks: {}, agents: {} },
      summary: { events: 0, failures: 0, retries: 0, tokens: 0, latencyMs: 0 },
    }
  }

  const fromSeq = options.fromSeq ?? events[0].seq
  if (!Number.isInteger(fromSeq) || fromSeq < 0) {
    throw new AceError('TRACE_CORRUPT', 'fromSeq must be a non-negative integer')
  }
  const toSeqExclusive = options.toSeqExclusive ?? events[events.length - 1].seq + 1

  const tasks = new Map()
  const agents = new Map()
  const calls = new Map()
  const stepStarts = new Map()
  const coordination = new Map()
  let previous = null
  let failures = 0
  let retries = 0
  let tokens = 0
  let latencyMs = 0

  for (const raw of events) {
    if (!raw || typeof raw !== 'object') {
      throw new AceError('TRACE_CORRUPT', 'event must be an object')
    }
    if (!Number.isInteger(raw.seq) || raw.seq < 0) {
      throw new AceError('TRACE_CORRUPT', `invalid seq: ${raw.seq}`)
    }
    if (previous !== null && raw.seq !== previous + 1) {
      throw new AceError('TRACE_CORRUPT', `non-contiguous seq ${raw.seq} after ${previous}`)
    }
    previous = raw.seq

    if (!KNOWN_EVENT_TYPES.has(raw.type) && raw.ignorable !== true) {
      throw new AceError('TRACE_CORRUPT', `unknown non-ignorable event type: ${raw.type}`)
    }
    const data = raw.data === undefined ? {} : raw.data
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new AceError('TRACE_CORRUPT', `event data must be an object at seq ${raw.seq}`)
    }

    const taskId = data.taskId ?? data.task ?? raw.taskRef
    const agentId = raw.actor ?? data.agentId ?? data.agent
    const timeMs = parseTime(raw.time)

    if (taskId) ensureTask(tasks, taskId)
    if (agentId) ensureAgent(agents, agentId)
    const task = taskId ? tasks.get(taskId) : null
    const agent = agentId ? agents.get(agentId) : null

    switch (raw.type) {
      case 'team/task': {
        const id = data.taskId ?? data.task ?? data.id
        if (!id) break
        const entry = ensureTask(tasks, id)
        if (typeof data.status === 'string') entry.status = data.status
        if (Array.isArray(data.dependsOn)) entry.dependsOn = [...data.dependsOn]
        const assignee = data.assignee ?? data.agentId
        if (assignee) entry.assignee = assignee
        if (data.criticality) entry.criticality = data.criticality
        if (Number.isFinite(data.expectedTokens)) entry.expectedTokens = data.expectedTokens
        if (Number.isFinite(data.expectedMs)) entry.expectedMs = data.expectedMs
        break
      }
      case 'agent/created':
      case 'team/member': {
        const id = data.agentId ?? data.id ?? data.member ?? agentId
        if (id) {
          const entry = ensureAgent(agents, id)
          if (data.kind) entry.kind = data.kind
          if (data.role) entry.role = data.role
        }
        break
      }
      case 'tool/call': {
        if (task) task.attempts += 1
        const callId = data.callId ?? raw.seq
        calls.set(`${taskId ?? agentId ?? 'unknown'}:${callId}`, raw.seq)
        break
      }
      case 'tool/result': {
        if (task) {
          if (data.isError === true) {
            task.failures += 1
            failures += 1
          }
        }
        if (agent && data.isError === true) agent.failures += 1
        const callId = data.callId ?? raw.seq
        for (const key of calls.keys()) {
          if (key.endsWith(`:${callId}`)) calls.delete(key)
        }
        break
      }
      case 'llm/retry':
      case 'llm/retry-started': {
        retries += 1
        if (task) task.retries += 1
        if (agent) agent.retries += 1
        break
      }
      case 'step/start': {
        const key = `${taskId ?? '-'}:${agentId ?? '-'}`
        stepStarts.set(key, timeMs)
        break
      }
      case 'step/end': {
        const key = `${taskId ?? '-'}:${agentId ?? '-'}`
        const start = stepStarts.get(key)
        if (typeof start === 'number' && timeMs !== null && timeMs >= start) {
          const elapsed = timeMs - start
          if (task) task.latencyMs += elapsed
          if (agent) agent.latencyMs += elapsed
          latencyMs += elapsed
        }
        stepStarts.delete(key)
        break
      }
      case 'assistant/message': {
        const usage = data.usage ?? {}
        const count = Number.isFinite(data.tokens)
          ? data.tokens
          : (Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0) +
            (Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0)
        if (task) task.tokens += count
        if (agent) agent.tokens += count
        tokens += count
        break
      }
      case 'team/message/queued':
      case 'team/message/delivered': {
        if (task) task.messages += 1
        if (agent) agent.messages += 1
        const from = data.from ?? agentId
        const to = data.to
        if (from && to) {
          const key = `${from}->${to}`
          coordination.set(key, (coordination.get(key) ?? 0) + 1)
        }
        break
      }
      default:
        break
    }
  }

  for (const [key, seq] of calls.entries()) {
    const taskId = key.split(':')[0]
    if (tasks.has(taskId)) tasks.get(taskId).unresolvedCalls += 1
    void seq
  }

  const taskList = [...tasks.values()].map((task) => ({ ...task }))
  const agentList = [...agents.values()].map((agent) => ({ ...agent }))
  const coordinationList = [...coordination.entries()].map(([key, count]) => {
    const [from, to] = key.split('->')
    return { from, to, count }
  })

  return {
    window: {
      fromSeq,
      toSeqExclusive,
      count: events.length,
      truncated: options.truncated === true,
      source: options.source ?? 'live',
      confidence: events.length > 0 ? 'observed-limited' : 'none',
    },
    tasks: taskList,
    agents: agentList,
    coordination: coordinationList,
    metrics: {
      tasks: Object.fromEntries(taskList.map((task) => [task.id, task])),
      agents: Object.fromEntries(agentList.map((agent) => [agent.id, agent])),
    },
    summary: { events: events.length, failures, retries, tokens, latencyMs },
  }
}

/**
 * Deterministic replay summary over a normalized trace.
 * @param {ReturnType<typeof normalizeTrace>} trace
 */
export function replayTrace(trace) {
  const ordered = clone(trace)
  return {
    fromSeq: ordered.window.fromSeq,
    toSeqExclusive: ordered.window.toSeqExclusive,
    eventCount: ordered.window.count,
    tasks: ordered.tasks.length,
    agents: ordered.agents.length,
    failures: ordered.summary.failures,
    retries: ordered.summary.retries,
    tokens: ordered.summary.tokens,
    latencyMs: ordered.summary.latencyMs,
    truncated: ordered.window.truncated,
    confidence: ordered.window.confidence,
  }
}
