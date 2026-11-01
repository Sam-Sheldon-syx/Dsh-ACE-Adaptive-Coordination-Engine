import test from 'node:test'
import assert from 'node:assert/strict'
import { applyChangeSet, createChangeSet } from '../../core/state.js'
import { topologyHash } from '../../core/graph.js'
import { clone } from '../../core/model.js'
import { sampleTopology } from '../core/fixtures.js'

const clock = () => '2026-11-01T00:00:00.000Z'

function changeSet(actions = [{ kind: 'reassign', taskId: 't1', toAgent: 'a2' }]) {
  const base = sampleTopology()
  const cs = createChangeSet({
    candidate: { id: 'fault-candidate', actions },
    baseTopology: base,
    clock,
  })
  return { base, cs }
}

test('F-20 stale base is rejected before any executor call', async () => {
  const { base, cs } = changeSet()
  const stale = clone(base)
  stale.version = 2
  stale.tasks.push({ id: 'intruder' })
  stale.hash = topologyHash(stale)
  let calls = 0
  const result = await applyChangeSet({
    changeSet: cs,
    currentTopology: stale,
    clock,
    execute: async () => { calls += 1 },
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'APPLY_CONFLICT')
  assert.match(result.error.message, /base topology changed/)
  assert.equal(calls, 0)
  assert.equal(result.changeSet.status, 'failed')
})

test('F-21 unchanged base proceeds and commits', async () => {
  const { base, cs } = changeSet()
  const result = await applyChangeSet({
    changeSet: cs,
    currentTopology: base,
    clock,
    execute: async () => {},
    verify: async () => true,
  })
  assert.equal(result.ok, true)
  assert.equal(result.changeSet.status, 'committed')
})

test('F-22 apply step failure compensates already-applied steps', async () => {
  const { cs } = changeSet([
    { kind: 'reassign', taskId: 't1', toAgent: 'a2' },
    { kind: 'reassign', taskId: 't2', toAgent: 'a1' },
  ])
  const directions = []
  const result = await applyChangeSet({
    changeSet: cs,
    clock,
    execute: async ({ step, direction }) => {
      directions.push(`${step.stepId}:${direction}`)
      if (direction === 'apply' && step.stepId === 'step-2') throw new Error('conflict')
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'APPLY_CONFLICT')
  assert.equal(result.changeSet.status, 'rolled-back')
  assert.deepEqual(directions, ['step-1:apply', 'step-2:apply', 'step-1:compensate'])
})

test('F-23 verification failure rolls back', async () => {
  const { cs } = changeSet()
  const result = await applyChangeSet({
    changeSet: cs,
    clock,
    execute: async () => {},
    verify: async () => false,
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'VERIFY_FAILED')
  assert.equal(result.changeSet.status, 'rolled-back')
})

test('F-24 compensation failure is surfaced, not hidden', async () => {
  const { cs } = changeSet([
    { kind: 'reassign', taskId: 't1', toAgent: 'a2' },
    { kind: 'reassign', taskId: 't2', toAgent: 'a1' },
  ])
  const result = await applyChangeSet({
    changeSet: cs,
    clock,
    execute: async ({ step, direction }) => {
      if (direction === 'apply' && step.stepId === 'step-2') throw new Error('apply failed')
      if (direction === 'compensate') throw new Error('compensation failed')
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'ROLLBACK_FAILED')
  assert.equal(result.changeSet.status, 'failed')
})
