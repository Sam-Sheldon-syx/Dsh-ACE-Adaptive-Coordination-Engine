import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAction, generateCandidates, inverseOf, validateTopology } from '../../core/topology.js'
import { topologyHash } from '../../core/graph.js'
import { mergeConfig } from '../../core/config.js'
import { sampleTopology } from './fixtures.js'

test('reassign updates assignment and inverse restores it', () => {
  const base = sampleTopology()
  const next = applyAction(base, { kind: 'reassign', taskId: 't1', toAgent: 'a2' })
  assert.equal(next.assignments.find((a) => a.taskId === 't1').agentId, 'a2')
  assert.notEqual(next.hash, topologyHash(base))
  const inverse = inverseOf(base, { kind: 'reassign', taskId: 't1', toAgent: 'a2' })
  assert.deepEqual(inverse, { kind: 'reassign', taskId: 't1', toAgent: 'a1' })
  const restored = applyAction(next, inverse)
  assert.equal(restored.assignments.find((a) => a.taskId === 't1').agentId, 'a1')
})

test('split creates parts with dependencies and assignments', () => {
  const base = sampleTopology()
  const next = applyAction(base, {
    kind: 'split',
    taskId: 't1',
    parts: [{ toAgent: 'a1' }, { toAgent: 'a2' }],
  })
  assert.equal(next.tasks.some((task) => task.id === 't1'), false)
  assert.deepEqual(next.tasks.map((task) => task.id).sort(), ['t1#1', 't1#2', 't2'])
  assert.equal(next.dependencies.filter((edge) => edge.to === 't2').length, 2)
  assert.deepEqual(validateTopology(next), [])
})

test('add-helper adds agent and inverse removes it', () => {
  const base = sampleTopology()
  const action = { kind: 'add-helper', agentSpec: { id: 'helper-9', role: 'helper' }, forTasks: ['t1'] }
  const next = applyAction(base, action)
  assert.ok(next.agents.some((agent) => agent.id === 'helper-9'))
  assert.equal(next.assignments.find((a) => a.taskId === 't1').agentId, 'helper-9')
  const inverse = inverseOf(base, action)
  assert.equal(inverse.kind, 'remove-helper')
  assert.equal(inverse.agentId, 'helper-9')
  const restored = applyAction(next, inverse)
  assert.equal(restored.agents.some((agent) => agent.id === 'helper-9'), false)
  assert.equal(restored.assignments.find((item) => item.taskId === 't1').agentId, 'a1')
})

test('rewire add/remove is symmetric', () => {
  const base = sampleTopology()
  const edge = { from: 'lead', to: 'a2', kind: 'delegation', weight: 1 }
  const added = applyAction(base, { kind: 'rewire', op: 'add', edge })
  assert.ok(added.coordination.some((item) => item.from === 'lead' && item.to === 'a2'))
  const removed = applyAction(added, { kind: 'rewire', op: 'remove', edge })
  assert.equal(removed.coordination.some((item) => item.from === 'lead' && item.to === 'a2'), false)
})

test('generateCandidates is bounded, valid and de-duplicated', () => {
  const base = sampleTopology()
  const region = { tasks: ['t1'], agents: ['a1', 'a2'] }
  const metrics = { tasks: { t1: { retries: 2 } } }
  const candidates = generateCandidates(base, region, mergeConfig(), metrics)
  assert.ok(candidates.length > 0)
  assert.ok(candidates.length <= 5)
  const hashes = new Set(candidates.map((candidate) => candidate.topology.hash))
  assert.equal(hashes.size, candidates.length)
  for (const candidate of candidates) {
    assert.deepEqual(validateTopology(candidate.topology), [])
    assert.equal(candidate.baseVersion, base.version)
  }
})
