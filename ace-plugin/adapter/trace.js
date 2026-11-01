/**
 * DSH session events -> ACE core trace/topology.
 *
 * The synthetic task model groups work by (turn, step) because persisted DSH
 * session events do not carry ACE task ids. This mapping is an adapter
 * choice, recorded in the P6 report; it is not a DSH task API.
 */
function adapterError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function extractSessionEvents(result) {
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.events)) return result.events
  if (Array.isArray(result?.records)) return result.records.map((record) => record.event ?? record)
  if (Array.isArray(result?.session?.events)) return result.session.events
  return null
}

export function getService(ctx, name) {
  try {
    if (typeof ctx?.get === 'function') {
      const value = ctx.get(name)
      if (value !== undefined) return value
    }
  } catch {
    // fall through to property access
  }
  try {
    return ctx?.[name]
  } catch {
    return undefined
  }
}

export async function readDshSession(ctx, sessionId) {
  const query = getService(ctx, 'sessionQuery')
  if (query && typeof query.readSession === 'function') {
    const result = await query.readSession(sessionId)
    const events = extractSessionEvents(result)
    if (events) return { events, source: 'sessionQuery' }
    throw adapterError('TRACE_CORRUPT', 'sessionQuery.readSession returned no events')
  }

  const persistence = getService(ctx, 'sessionPersistence')
  if (persistence && typeof persistence.open === 'function') {
    const handle = await persistence.open(sessionId, 'read')
    try {
      const result = await handle.read()
      const events = extractSessionEvents(result)
      if (events) return { events, source: 'sessionPersistence.open/read' }
      throw adapterError('TRACE_CORRUPT', 'sessionPersistence handle returned no events')
    } finally {
      if (handle && typeof handle.close === 'function') await handle.close()
    }
  }

  const sessions = getService(ctx, 'sessions')
  if (sessions && typeof sessions.get === 'function') {
    const session = await sessions.get(sessionId)
    if (!session) throw adapterError('TRACE_UNAVAILABLE', `session not found: ${sessionId}`)
    if (typeof session.snapshotEvents === 'function' && Number.isInteger(session.seq)) {
      return { events: session.snapshotEvents(0, session.seq), source: 'sessions.snapshotEvents' }
    }
    if (Array.isArray(session.events)) return { events: session.events, source: 'sessions.events' }
  }

  throw adapterError('TRACE_UNAVAILABLE', 'no sessionQuery or sessions service available')
}

/** Map a DSH event payload into the simplified core event shape. */
function mapEvent(event, callTask) {
  const data = event.data ?? {}
  const turn = Number.isFinite(data.turn) ? data.turn : null
  const step = Number.isFinite(data.step) ? data.step : null
  const taskId = turn !== null && step !== null ? `step:${turn}:${step}` : `event:${event.seq}`

  switch (event.type) {
    case 'tool/call': {
      if (data.callId) callTask.set(data.callId, taskId)
      return {
        seq: event.seq,
        time: event.time,
        type: 'tool/call',
        data: { taskId, agentId: 'lead', callId: data.callId, name: data.name },
      }
    }
    case 'tool/result': {
      const mappedTask = data.callId ? callTask.get(data.callId) ?? taskId : taskId
      return {
        seq: event.seq,
        time: event.time,
        type: 'tool/result',
        data: {
          taskId: mappedTask,
          agentId: 'lead',
          callId: data.callId,
          isError: data.message?.isError === true || data.isError === true,
        },
      }
    }
    case 'assistant/message': {
      const usage = data.usage ?? {}
      return {
        seq: event.seq,
        time: event.time,
        type: 'assistant/message',
        data: {
          taskId,
          agentId: 'lead',
          tokens: Number.isFinite(usage.totalTokens) ? usage.totalTokens : undefined,
          usage,
        },
      }
    }
    case 'step/start':
    case 'step/end':
      return { seq: event.seq, time: event.time, type: event.type, data: { taskId, agentId: 'lead', turn, step } }
    case 'llm/retry':
    case 'llm/retry-started':
      return { seq: event.seq, time: event.time, type: event.type, data: { taskId, agentId: 'lead' } }
    case 'team/member': {
      const member = data.member ?? {}
      if (!member.id) return { seq: event.seq, time: event.time, type: 'plugin:adapter-skip', data: {}, ignorable: true }
      return {
        seq: event.seq,
        time: event.time,
        type: 'team/member',
        data: { agentId: member.id, kind: 'teammate', role: member.name },
      }
    }
    case 'team/task':
      return { seq: event.seq, time: event.time, type: 'plugin:adapter-skip', data: {}, ignorable: true }
    default:
      return { seq: event.seq, time: event.time, type: 'plugin:adapter-skip', data: {}, ignorable: true }
  }
}

/**
 * @param {object[]} events raw DSH session events (header line may be included)
 * @param {{sessionId?: string}} [options]
 */
export function mapDshEvents(events, options = {}) {
  const sessionId = options.sessionId ?? 'dsh-session'
  const liveAgentIds = Array.isArray(options.liveAgentIds) ? new Set(options.liveAgentIds) : null
  const raw = (events ?? []).filter((event) => event && Number.isInteger(event.seq))
  raw.sort((a, b) => a.seq - b.seq)

  const callTask = new Map()
  const mapped = []
  const stats = {
    inputEvents: (events ?? []).length,
    mappedEvents: 0,
    headerEvents: (events ?? []).length - raw.length,
    toolCalls: 0,
    toolResults: 0,
    failures: 0,
    retries: 0,
    members: 0,
    tasks: 0,
    tokens: 0,
  }

  for (const event of raw) {
    const out = mapEvent(event, callTask)
    if (out.ignorable !== true) {
      mapped.push(out)
      stats.mappedEvents += 1
      if (out.type === 'tool/call') stats.toolCalls += 1
      if (out.type === 'tool/result') {
        stats.toolResults += 1
        if (out.data.isError === true) stats.failures += 1
      }
      if (out.type === 'llm/retry' || out.type === 'llm/retry-started') stats.retries += 1
      if (out.type === 'team/member') stats.members += 1
      if (out.type === 'assistant/message' && Number.isFinite(out.data.tokens)) stats.tokens += out.data.tokens
    } else {
      // Preserve sequence continuity for the core validator.
      mapped.push(out)
    }
  }

  const taskMeta = new Map()
  const taskOrder = []
  const finish = (taskId) => {
    if (!taskMeta.has(taskId)) {
      taskMeta.set(taskId, { id: taskId, firstSeq: Number.MAX_SAFE_INTEGER, lastSeq: -1, expectedTokens: 0, expectedMs: 0 })
      taskOrder.push(taskId)
    }
    return taskMeta.get(taskId)
  }

  for (const event of mapped) {
    const data = event.data ?? {}
    if (!data.taskId) continue
    const meta = finish(data.taskId)
    meta.firstSeq = Math.min(meta.firstSeq, event.seq)
    meta.lastSeq = Math.max(meta.lastSeq, event.seq)
    if (event.type === 'assistant/message' && Number.isFinite(data.tokens)) meta.expectedTokens += data.tokens
    if (event.type === 'step/start') meta.startedAt = Date.parse(event.time)
    if (event.type === 'step/end' && Number.isFinite(meta.startedAt)) {
      const endedAt = Date.parse(event.time)
      if (Number.isFinite(endedAt) && endedAt >= meta.startedAt) meta.expectedMs += endedAt - meta.startedAt
    }
  }

  taskOrder.sort((a, b) => (taskMeta.get(a).firstSeq - taskMeta.get(b).firstSeq))
  stats.tasks = taskOrder.length

  const tasks = taskOrder.map((id) => {
    const meta = taskMeta.get(id)
    return {
      id,
      title: id,
      criticality: 'medium',
      ...(meta.expectedTokens > 0 ? { expectedTokens: meta.expectedTokens } : {}),
      ...(meta.expectedMs > 0 ? { expectedMs: meta.expectedMs } : {}),
    }
  })

  const dependencies = []
  let previous = null
  for (const id of taskOrder) {
    if (previous) dependencies.push({ from: previous, to: id, weight: 1 })
    previous = id
  }

  const members = new Set()
  for (const event of mapped) {
    if (event.type === 'team/member' && event.data?.agentId && (!liveAgentIds || liveAgentIds.has(event.data.agentId))) {
      members.add(event.data.agentId)
    }
  }

  const agents = [{ id: 'lead', kind: 'lead' }]
  for (const id of members) agents.push({ id, kind: 'teammate' })
  if (liveAgentIds) {
    for (const id of liveAgentIds) {
      if (id !== 'lead' && !agents.some((agent) => agent.id === id)) agents.push({ id, kind: 'teammate' })
    }
  }
  const coordination = agents
    .filter((agent) => agent.kind !== 'lead')
    .map((agent) => ({ from: 'lead', to: agent.id, kind: 'delegation', weight: 1 }))

  const topology = {
    version: 0,
    sessionId,
    tasks,
    agents,
    dependencies,
    coordination,
    assignments: tasks.map((task) => ({ taskId: task.id, agentId: 'lead' })),
    policy: { maxAgents: 8, maxParallel: 4 },
    taskModel: 'steps',
  }

  return { events: mapped, topology, stats }
}
