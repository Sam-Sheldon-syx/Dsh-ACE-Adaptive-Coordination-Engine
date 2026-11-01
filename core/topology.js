/**
 * Candidate topology generation and pure topology edits.
 * No DSH dependency; every action is a pure transform over a topology clone.
 */
import { AceError, assert, clone, hashOf } from './model.js'
import { canonicalTopology, topologyHash } from './graph.js'

function taskById(topology, id) {
  return topology.tasks.find((task) => task.id === id)
}

function agentById(topology, id) {
  return topology.agents.find((agent) => agent.id === id)
}

function assignmentOf(topology, taskId) {
  return topology.assignments.find((assignment) => assignment.taskId === taskId)
}

function dedupeEdges(edges, kindField = 'kind') {
  const seen = new Set()
  const out = []
  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}:${kindField ? edge[kindField] ?? '' : ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(edge)
  }
  return out
}

/**
 * Apply one action to a topology and return a new topology.
 * @param {object} topology
 * @param {object} action
 */
export function applyAction(topology, action) {
  const next = clone(topology)
  switch (action.kind) {
    case 'reassign': {
      const agent = agentById(next, action.toAgent)
      assert(agent, 'CONFIG_INVALID', `unknown agent: ${action.toAgent}`)
      const assignment = assignmentOf(next, action.taskId)
      assert(assignment, 'CONFIG_INVALID', `unknown task assignment: ${action.taskId}`)
      assignment.agentId = action.toAgent
      break
    }
    case 'unassign': {
      const assignment = assignmentOf(next, action.taskId)
      assert(assignment, 'CONFIG_INVALID', `unknown task assignment: ${action.taskId}`)
      assignment.agentId = null
      break
    }
    case 'split': {
      const original = taskById(next, action.taskId)
      assert(original, 'CONFIG_INVALID', `unknown task: ${action.taskId}`)
      const parts = action.parts ?? []
      assert(parts.length >= 2, 'CONFIG_INVALID', 'split needs at least two parts')
      const partIds = parts.map((part, index) => part.id ?? `${original.id}#${index + 1}`)
      const partTasks = parts.map((part, index) => ({
        ...clone(original),
        id: partIds[index],
        title: part.title ?? `${original.title ?? original.id} (part ${index + 1})`,
        expectedTokens: Number.isFinite(original.expectedTokens)
          ? Math.ceil(original.expectedTokens / parts.length)
          : undefined,
        expectedMs: Number.isFinite(original.expectedMs)
          ? Math.ceil(original.expectedMs / parts.length)
          : undefined,
      }))
      next.tasks = next.tasks.filter((task) => task.id !== original.id).concat(partTasks)

      const predecessors = next.dependencies.filter((edge) => edge.to === original.id)
      const successors = next.dependencies.filter((edge) => edge.from === original.id)
      next.dependencies = next.dependencies.filter(
        (edge) => edge.from !== original.id && edge.to !== original.id,
      )
      for (const branch of predecessors) {
        for (const partId of partIds) next.dependencies.push({ ...branch, to: partId })
      }
      for (const branch of successors) {
        for (const partId of partIds) next.dependencies.push({ ...branch, from: partId })
      }
      next.dependencies = dedupeEdges(next.dependencies, null)

      next.assignments = next.assignments.filter((assignment) => assignment.taskId !== original.id)
      parts.forEach((part, index) => {
        next.assignments.push({ taskId: partIds[index], agentId: part.toAgent ?? null })
      })
      break
    }
    case 'merge': {
      const partIds = action.partIds ?? []
      const original = action.originalTask
      assert(original, 'CONFIG_INVALID', 'merge needs the original task')
      const partSet = new Set(partIds)
      next.tasks = next.tasks.filter((task) => !partSet.has(task.id))
      if (!taskById(next, original.id)) next.tasks.push(clone(original))
      next.dependencies = next.dependencies.filter(
        (edge) => !partSet.has(edge.from) && !partSet.has(edge.to),
      )
      for (const edge of action.originalDependencies ?? []) next.dependencies.push(clone(edge))
      next.dependencies = dedupeEdges(next.dependencies, null)
      next.assignments = next.assignments.filter(
        (assignment) => !partSet.has(assignment.taskId),
      )
      if (action.originalAssignment) next.assignments.push(clone(action.originalAssignment))
      break
    }
    case 'add-helper': {
      const id = action.agentSpec?.id ?? `helper-${next.agents.length + 1}`
      assert(!agentById(next, id), 'CONFIG_INVALID', `agent already exists: ${id}`)
      next.agents.push({ id, kind: 'candidate', role: action.agentSpec?.role ?? 'helper' })
      const target = (action.forTasks ?? []).find((taskId) => taskById(next, taskId))
      if (target) {
        const assignment = assignmentOf(next, target)
        if (assignment) assignment.agentId = id
        else next.assignments.push({ taskId: target, agentId: id })
      }
      break
    }
    case 'remove-helper': {
      next.agents = next.agents.filter((agent) => agent.id !== action.agentId)
      next.assignments = next.assignments.map((assignment) =>
        assignment.agentId === action.agentId ? { ...assignment, agentId: null } : assignment,
      )
      for (const restore of action.restoreAssignments ?? []) {
        const assignment = assignmentOf(next, restore.taskId)
        if (assignment) assignment.agentId = restore.agentId ?? null
        else next.assignments.push({ taskId: restore.taskId, agentId: restore.agentId ?? null })
      }
      next.coordination = next.coordination.filter(
        (edge) => edge.from !== action.agentId && edge.to !== action.agentId,
      )
      break
    }
    case 'rewire': {
      if (action.op === 'remove') {
        next.coordination = next.coordination.filter(
          (edge) =>
            !(
              edge.from === action.edge.from &&
              edge.to === action.edge.to &&
              (edge.kind ?? 'message') === (action.edge.kind ?? 'message')
            ),
        )
      } else {
        next.coordination.push(clone(action.edge))
        next.coordination = dedupeEdges(next.coordination, 'kind')
      }
      break
    }
    case 'retry-policy': {
      const task = taskById(next, action.taskId)
      assert(task, 'CONFIG_INVALID', `unknown task: ${action.taskId}`)
      task.retryPolicy = clone(action.policy)
      break
    }
    default:
      throw new AceError('CONFIG_INVALID', `unknown action kind: ${action.kind}`)
  }
  next.hash = topologyHash(next)
  return next
}

/**
 * Compute the inverse action for a change created against `before`.
 * @param {object} before topology before the action
 * @param {object} action
 */
export function inverseOf(before, action) {
  switch (action.kind) {
    case 'reassign': {
      const assignment = assignmentOf(before, action.taskId)
      return assignment?.agentId
        ? { kind: 'reassign', taskId: action.taskId, toAgent: assignment.agentId }
        : { kind: 'unassign', taskId: action.taskId }
    }
    case 'unassign': {
      const assignment = assignmentOf(before, action.taskId)
      return assignment?.agentId
        ? { kind: 'reassign', taskId: action.taskId, toAgent: assignment.agentId }
        : undefined
    }
    case 'split': {
      const original = taskById(before, action.taskId)
      const partIds = (action.parts ?? []).map((part, index) => part.id ?? `${action.taskId}#${index + 1}`)
      return {
        kind: 'merge',
        partIds,
        originalTask: clone(original),
        originalDependencies: clone(
          before.dependencies.filter((edge) => edge.from === original.id || edge.to === original.id),
        ),
        originalAssignment: clone(assignmentOf(before, action.taskId)),
      }
    }
    case 'add-helper': {
      const id = action.agentSpec?.id ?? `helper-${before.agents.length + 1}`
      const target = (action.forTasks ?? []).find((taskId) => assignmentOf(before, taskId))
      const previous = target ? assignmentOf(before, target) : undefined
      return {
        kind: 'remove-helper',
        agentId: id,
        restoreAssignments: target
          ? [{ taskId: target, agentId: previous?.agentId ?? null }]
          : [],
      }
    }
    case 'rewire':
      return {
        kind: 'rewire',
        op: action.op === 'remove' ? 'add' : 'remove',
        edge: clone(action.edge),
      }
    case 'retry-policy': {
      const task = taskById(before, action.taskId)
      return { kind: 'retry-policy', taskId: action.taskId, policy: task.retryPolicy ?? null }
    }
    case 'remove-helper':
    case 'merge':
      return undefined
    default:
      return undefined
  }
}

/** Basic structural validation. Returns a list of problem strings. */
export function validateTopology(topology, config = {}) {
  const problems = []
  const taskIds = new Set()
  for (const task of topology.tasks ?? []) {
    if (taskIds.has(task.id)) problems.push(`duplicate task: ${task.id}`)
    taskIds.add(task.id)
  }
  const agentIds = new Set()
  for (const agent of topology.agents ?? []) {
    if (agentIds.has(agent.id)) problems.push(`duplicate agent: ${agent.id}`)
    agentIds.add(agent.id)
  }
  for (const assignment of topology.assignments ?? []) {
    if (!taskIds.has(assignment.taskId)) problems.push(`assignment for unknown task: ${assignment.taskId}`)
    if (assignment.agentId !== null && !agentIds.has(assignment.agentId)) {
      problems.push(`assignment for unknown agent: ${assignment.agentId}`)
    }
  }
  for (const edge of topology.dependencies ?? []) {
    if (!taskIds.has(edge.from) || !taskIds.has(edge.to)) {
      problems.push(`dependency references unknown task: ${edge.from}->${edge.to}`)
    }
    if (edge.from === edge.to) problems.push(`self dependency: ${edge.from}`)
  }
  for (const edge of topology.coordination ?? []) {
    if (!agentIds.has(edge.from) || !agentIds.has(edge.to)) {
      problems.push(`coordination references unknown agent: ${edge.from}->${edge.to}`)
    }
  }
  if (topology.policy?.maxAgents && agentIds.size > topology.policy.maxAgents) {
    problems.push(`agent count ${agentIds.size} exceeds maxAgents ${topology.policy.maxAgents}`)
  }
  if (hasDependencyCycle(topology)) problems.push('dependency cycle detected')
  void config
  return problems
}

function hasDependencyCycle(topology) {
  const outgoing = new Map()
  for (const edge of topology.dependencies ?? []) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, [])
    outgoing.get(edge.from).push(edge.to)
  }
  const state = new Map()
  const visit = (node) => {
    if (state.get(node) === 'visiting') return true
    if (state.get(node) === 'done') return false
    state.set(node, 'visiting')
    for (const next of outgoing.get(node) ?? []) {
      if (visit(next)) return true
    }
    state.set(node, 'done')
    return false
  }
  for (const task of topology.tasks ?? []) {
    if (visit(task.id)) return true
  }
  return false
}

const ACTION_RANK = { reassign: 1, 'retry-policy': 2, split: 3, 'add-helper': 4, rewire: 5 }

/**
 * Generate a bounded candidate set inside an impact region.
 * @param {object} topology
 * @param {object} region
 * @param {object} config merged config
 * @param {object} [metrics] normalized trace metrics (for retry actions)
 */
export function generateCandidates(topology, region, config, metrics = {}) {
  const taskIds = new Set(region.tasks ?? [])
  const agentIds = new Set(region.agents ?? [])
  const actions = []
  const baseAgentCount = topology.agents.length

  for (const taskId of taskIds) {
    const assignment = assignmentOf(topology, taskId)
    const currentAgent = assignment?.agentId ?? null
    const targets = topology.agents
      .filter((agent) => agent.id !== currentAgent)
      .slice(0, 2)
    for (const target of targets) {
      actions.push({ kind: 'reassign', taskId, toAgent: target.id })
    }

    const task = taskById(topology, taskId)
    const splitThreshold = config.thresholds.splitTokens
    if (task && Number.isFinite(task.expectedTokens) && task.expectedTokens >= splitThreshold) {
      const partAgents = topology.agents.slice(0, 2).map((agent) => agent.id)
      actions.push({
        kind: 'split',
        taskId,
        parts: partAgents.map((agentId, index) => ({
          title: `${task.title ?? task.id} (part ${index + 1})`,
          toAgent: agentId,
        })),
      })
    }

    const taskMetrics = metrics.tasks?.[taskId]
    if (taskMetrics && taskMetrics.retries > 0) {
      actions.push({
        kind: 'retry-policy',
        taskId,
        policy: { maxRetries: Math.max(1, taskMetrics.retries + 1) },
      })
    }
  }

  if (topology.agents.length < (topology.policy?.maxAgents ?? 8) && taskIds.size > 0) {
    const helperId = `helper-${baseAgentCount + 1}`
    actions.push({
      kind: 'add-helper',
      agentSpec: { id: helperId, role: 'helper' },
      forTasks: [...taskIds].slice(0, 2),
    })
  }

  const regionAgents = topology.agents.filter((agent) => agentIds.has(agent.id))
  if (regionAgents.length >= 2) {
    const [a, b] = regionAgents
    const exists = topology.coordination.some(
      (edge) =>
        (edge.from === a.id && edge.to === b.id) || (edge.from === b.id && edge.to === a.id),
    )
    if (!exists) {
      actions.push({
        kind: 'rewire',
        op: 'add',
        edge: { from: a.id, to: b.id, kind: 'delegation', weight: 1 },
      })
    }
  }

  const candidates = []
  const seen = new Set()
  for (const action of actions) {
    let next
    try {
      next = applyAction(topology, action)
    } catch {
      continue
    }
    const problems = validateTopology(next)
    if (problems.length > 0) continue
    const agentDelta = next.agents.length - baseAgentCount
    if (agentDelta > config.maxAgentDelta) continue
    const hash = topologyHash(next)
    if (seen.has(hash)) continue
    seen.add(hash)
    candidates.push({
      id: `cand-${hash.slice(0, 12)}`,
      baseVersion: topology.version,
      actions: [action],
      topology: next,
      heuristic: {
        rank: ACTION_RANK[action.kind] ?? 9,
        agentDelta,
        affectedTasks: [...taskIds].length,
        hash,
      },
      predicted: {
        quality: { state: 'unknown', reason: 'not evaluated' },
        latencyMs: { state: 'unknown', reason: 'not evaluated' },
        tokens: { state: 'unknown', reason: 'not evaluated' },
        riskEvents: { state: 'unknown', reason: 'not evaluated' },
        reconfigCost: agentDelta,
      },
      confidence: 'none',
    })
  }

  candidates.sort((a, b) => {
    if (a.heuristic.rank !== b.heuristic.rank) return a.heuristic.rank - b.heuristic.rank
    if (a.heuristic.agentDelta !== b.heuristic.agentDelta) {
      return a.heuristic.agentDelta - b.heuristic.agentDelta
    }
    return a.id.localeCompare(b.id)
  })

  return candidates.slice(0, config.maxCandidates)
}

export function candidateTopologyHash(candidate) {
  return candidate.topology?.hash ?? hashOf(canonicalTopology(candidate.topology))
}
