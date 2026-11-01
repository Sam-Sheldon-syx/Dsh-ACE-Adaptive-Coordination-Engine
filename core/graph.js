/**
 * Task/coordination graphs, topology representation, and local impact regions.
 * Pure data operations; no DSH dependency.
 */
import { assert, clone, hashOf } from './model.js'

export function emptyTopology(sessionId = 'synthetic') {
  return {
    version: 0,
    parentVersion: undefined,
    sessionId,
    tasks: [],
    agents: [],
    dependencies: [],
    coordination: [],
    assignments: [],
    policy: { maxAgents: 8, maxParallel: 4 },
    hash: '',
  }
}

/**
 * Build a topology from a normalized trace, or normalize a seed topology.
 * @param {object} trace normalized trace
 * @param {{sessionId?: string, seedTopology?: object, policy?: object}} [options]
 */
export function buildTopology(trace, options = {}) {
  if (options.seedTopology) {
    const seed = clone(options.seedTopology)
    seed.sessionId ??= options.sessionId ?? 'synthetic'
    seed.tasks ??= []
    seed.agents ??= []
    seed.dependencies ??= []
    seed.coordination ??= []
    seed.assignments ??= []
    seed.policy ??= { maxAgents: 8, maxParallel: 4 }
    seed.hash = topologyHash(seed)
    return seed
  }

  const tasks = (trace.tasks ?? []).map((task) => ({
    id: task.id,
    title: task.title ?? task.id,
    criticality: task.criticality ?? 'medium',
    expectedTokens: Number.isFinite(task.expectedTokens) ? task.expectedTokens : undefined,
    expectedMs: Number.isFinite(task.expectedMs) ? task.expectedMs : undefined,
  }))
  const taskIds = new Set(tasks.map((task) => task.id))

  const agents = (trace.agents ?? []).map((agent) => ({
    id: agent.id,
    kind: agent.kind ?? 'teammate',
    role: agent.role,
    maxParallel: Number.isFinite(agent.maxParallel) ? agent.maxParallel : undefined,
  }))
  if (agents.length === 0) agents.push({ id: 'lead', kind: 'lead' })
  const agentIds = new Set(agents.map((agent) => agent.id))

  const dependencies = []
  for (const task of trace.tasks ?? []) {
    for (const dep of task.dependsOn ?? []) {
      if (taskIds.has(dep) && taskIds.has(task.id)) {
        dependencies.push({ from: dep, to: task.id, weight: 1 })
      }
    }
  }

  const assignments = []
  for (const task of trace.tasks ?? []) {
    const assignee = task.assignee && agentIds.has(task.assignee) ? task.assignee : null
    assignments.push({ taskId: task.id, agentId: assignee })
  }

  const coordination = []
  for (const edge of trace.coordination ?? []) {
    if (agentIds.has(edge.from) && agentIds.has(edge.to)) {
      coordination.push({ from: edge.from, to: edge.to, kind: 'message', weight: edge.count ?? 1 })
    }
  }
  if (coordination.length === 0 && agents.length > 1) {
    const coordinator = agents.find((agent) => agent.kind === 'lead') ?? agents[0]
    for (const agent of agents) {
      if (agent.id !== coordinator.id) {
        coordination.push({ from: coordinator.id, to: agent.id, kind: 'delegation', weight: 1 })
      }
    }
  }

  const topology = {
    version: 0,
    sessionId: options.sessionId ?? 'synthetic',
    tasks,
    agents,
    dependencies,
    coordination,
    assignments,
    policy: { maxAgents: 8, maxParallel: 4, ...(options.policy ?? {}) },
  }
  topology.hash = topologyHash(topology)
  return topology
}

/** Stable topology shape: sorted arrays, optional fields removed. */
export function canonicalTopology(topology) {
  return {
    sessionId: topology.sessionId,
    version: topology.version,
    tasks: [...topology.tasks].map((task) => ({
      id: task.id,
      title: task.title ?? task.id,
      criticality: task.criticality ?? 'medium',
      ...(Number.isFinite(task.expectedTokens) ? { expectedTokens: task.expectedTokens } : {}),
      ...(Number.isFinite(task.expectedMs) ? { expectedMs: task.expectedMs } : {}),
      ...(task.retryPolicy ? { retryPolicy: task.retryPolicy } : {}),
    })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    agents: [...topology.agents].map((agent) => ({
      id: agent.id,
      kind: agent.kind ?? 'teammate',
      ...(agent.role ? { role: agent.role } : {}),
      ...(Number.isFinite(agent.maxParallel) ? { maxParallel: agent.maxParallel } : {}),
    })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    dependencies: [...topology.dependencies]
      .map((edge) => ({ from: edge.from, to: edge.to, weight: edge.weight ?? 1 }))
      .sort(edgeCompare),
    coordination: [...topology.coordination]
      .map((edge) => ({
        from: edge.from,
        to: edge.to,
        kind: edge.kind ?? 'message',
        weight: edge.weight ?? 1,
      }))
      .sort(edgeCompare),
    assignments: [...topology.assignments]
      .map((assignment) => ({ taskId: assignment.taskId, agentId: assignment.agentId ?? null }))
      .sort((a, b) => String(a.taskId).localeCompare(String(b.taskId))),
    policy: {
      maxAgents: topology.policy?.maxAgents ?? 8,
      maxParallel: topology.policy?.maxParallel ?? 4,
    },
  }
}

function edgeCompare(a, b) {
  return `${a.from}->${a.to}:${a.kind ?? ''}`.localeCompare(`${b.from}->${b.to}:${b.kind ?? ''}`)
}

export function topologyHash(topology) {
  return hashOf(canonicalTopology(topology))
}

export function cloneTopology(topology) {
  const copy = clone(topology)
  copy.hash = topologyHash(copy)
  return copy
}

/** Build a bidirectional adjacency map over the union graph. */
export function buildAdjacency(topology) {
  /** @type {Map<string, Set<string>>} */
  const adjacency = new Map()
  const add = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set())
    if (!adjacency.has(b)) adjacency.set(b, new Set())
    adjacency.get(a).add(b)
    adjacency.get(b).add(a)
  }
  for (const edge of topology.dependencies) {
    if (edge.from && edge.to) add(`task:${edge.from}`, `task:${edge.to}`)
  }
  for (const assignment of topology.assignments) {
    if (assignment.taskId && assignment.agentId) {
      add(`task:${assignment.taskId}`, `agent:${assignment.agentId}`)
    }
  }
  for (const edge of topology.coordination) {
    if (edge.from && edge.to) add(`agent:${edge.from}`, `agent:${edge.to}`)
  }
  return adjacency
}

/**
 * Bounded BFS from anomaly seeds.
 * @param {object} topology
 * @param {Array<{kind: 'task'|'agent', id: string}>} seeds
 * @param {{maxHops?: number, maxNodes?: number}} [options]
 */
export function impactRegion(topology, seeds, options = {}) {
  const maxHops = Number.isInteger(options.maxHops) ? options.maxHops : 2
  const maxNodes = Number.isInteger(options.maxNodes) ? options.maxNodes : 24
  const adjacency = buildAdjacency(topology)
  const taskSet = new Set(topology.tasks.map((task) => task.id))
  const agentSet = new Set(topology.agents.map((agent) => agent.id))

  const queue = []
  const visited = new Set()
  for (const seed of seeds ?? []) {
    if (!seed || !seed.id) continue
    const key = seed.kind === 'agent' ? `agent:${seed.id}` : `task:${seed.id}`
    if (!adjacency.has(key)) continue
    if (!visited.has(key)) {
      visited.add(key)
      queue.push({ key, hops: 0 })
    }
  }

  let truncated = false
  while (queue.length > 0) {
    const current = queue.shift()
    if (current.hops >= maxHops) continue
    for (const next of adjacency.get(current.key) ?? []) {
      if (visited.has(next)) continue
      if (visited.size >= maxNodes) {
        truncated = true
        continue
      }
      visited.add(next)
      queue.push({ key: next, hops: current.hops + 1 })
    }
  }

  const tasks = []
  const agents = []
  for (const key of visited) {
    const [kind, id] = splitKey(key)
    if (kind === 'task' && taskSet.has(id)) tasks.push(id)
    if (kind === 'agent' && agentSet.has(id)) agents.push(id)
  }
  tasks.sort()
  agents.sort()

  const boundary = []
  for (const key of visited) {
    for (const next of adjacency.get(key) ?? []) {
      if (visited.has(next)) continue
      boundary.push(`${key}=>${next}`)
    }
  }
  boundary.sort()

  return {
    seeds: [...(seeds ?? [])],
    tasks,
    agents,
    boundary: [...new Set(boundary)],
    truncated,
    maxHops,
    maxNodes,
  }
}

function splitKey(key) {
  const index = key.indexOf(':')
  return [key.slice(0, index), key.slice(index + 1)]
}

export function findTask(topology, taskId) {
  return topology.tasks.find((task) => task.id === taskId)
}

export function assignmentOf(topology, taskId) {
  return topology.assignments.find((assignment) => assignment.taskId === taskId)?.agentId ?? null
}

export function topologyStats(topology) {
  return {
    tasks: topology.tasks.length,
    agents: topology.agents.length,
    dependencies: topology.dependencies.length,
    coordination: topology.coordination.length,
    assigned: topology.assignments.filter((assignment) => assignment.agentId !== null).length,
    unassigned: topology.assignments.filter((assignment) => assignment.agentId === null).length,
  }
}

export function requireTopology(topology) {
  assert(topology && Array.isArray(topology.tasks), 'CONFIG_INVALID', 'topology.tasks is required')
  assert(Array.isArray(topology.agents), 'CONFIG_INVALID', 'topology.agents is required')
  return topology
}
