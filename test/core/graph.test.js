import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTopology, impactRegion, topologyHash, topologyStats } from '../../core/graph.js'
import { validateTopology } from '../../core/topology.js'
import { normalizeTrace } from '../../core/trace.js'
import { sampleEvents, sampleTopology } from './fixtures.js'

test('builds a topology from a trace', () => {
  const trace = normalizeTrace(sampleEvents())
  const topology = buildTopology(trace)
  assert.equal(topology.tasks.length, 2)
  assert.equal(topology.agents.length, 2)
  assert.equal(topology.assignments.find((a) => a.taskId === 't1').agentId, 'a1')
  assert.equal(topology.dependencies[0].from, 't1')
  assert.equal(topology.dependencies[0].to, 't2')
  assert.equal(topologyStats(topology).assigned, 2)
  assert.match(topology.hash, /^[a-f0-9]{64}$/)
  assert.deepEqual(validateTopology(topology), [])
  assert.ok(topology.coordination.every((edge) => topology.agents.some((agent) => agent.id === edge.from)))
})

test('impact region is bounded and deterministic', () => {
  const topology = sampleTopology()
  const region = impactRegion(topology, [{ kind: 'task', id: 't1' }], { maxHops: 2, maxNodes: 10 })
  assert.deepEqual(region.tasks, ['t1', 't2'])
  assert.deepEqual(region.agents, ['a1', 'a2', 'lead'])
  assert.equal(region.truncated, false)
  const again = impactRegion(topology, [{ kind: 'task', id: 't1' }], { maxHops: 2, maxNodes: 10 })
  assert.deepEqual(region, again)
})

test('impact region truncates at maxNodes', () => {
  const topology = sampleTopology()
  const region = impactRegion(topology, [{ kind: 'task', id: 't1' }], { maxHops: 3, maxNodes: 2 })
  assert.equal(region.truncated, true)
  assert.ok(region.tasks.length + region.agents.length <= 2)
})

test('topology hash is stable', () => {
  const a = sampleTopology()
  const b = sampleTopology()
  assert.equal(topologyHash(a), topologyHash(b))
  b.tasks.push({ id: 't3' })
  assert.notEqual(topologyHash(a), topologyHash(b))
})

test('validateTopology reports structural problems', () => {
  const topology = sampleTopology()
  assert.deepEqual(validateTopology(topology), [])
  topology.assignments.push({ taskId: 'missing', agentId: 'ghost' })
  const problems = validateTopology(topology)
  assert.ok(problems.some((problem) => problem.includes('unknown task')))
  assert.ok(problems.some((problem) => problem.includes('unknown agent')))
})
