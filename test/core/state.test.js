import test from 'node:test'
import assert from 'node:assert/strict'
import { applyChangeSet, createChangeSet, rollbackChangeSet } from '../../core/state.js'
import { generateCandidates } from '../../core/topology.js'
import { mergeConfig } from '../../core/config.js'
import { sampleTopology } from './fixtures.js'

const clock = () => '2026-11-01T00:00:00.000Z'

function candidateForStep() {
  const base = sampleTopology()
  const region = { tasks: ['t1'], agents: ['a1', 'a2'] }
  const candidates = generateCandidates(base, region, mergeConfig())
  assert.ok(candidates.length > 0)
  return { base, candidate: candidates[0] }
}

test('ChangeSet applies through the injected executor and commits', async () => {
  const { base, candidate } = candidateForStep()
  const changeSet = createChangeSet({ candidate, baseTopology: base, clock })
  const calls = []
  const result = await applyChangeSet({
    changeSet,
    clock,
    execute: async ({ step, direction }) => { calls.push({ stepId: step.stepId, direction }) },
    verify: async () => true,
  })
  assert.equal(result.ok, true)
  assert.equal(result.changeSet.status, 'committed')
  assert.deepEqual(calls, [{ stepId: 'step-1', direction: 'apply' }])
  assert.equal(result.topology.hash, changeSet.targetTopologyHash)
})

test('verification failure rolls back applied steps', async () => {
  const { base, candidate } = candidateForStep()
  const changeSet = createChangeSet({ candidate, baseTopology: base, clock })
  const directions = []
  const result = await applyChangeSet({
    changeSet,
    clock,
    execute: async ({ direction }) => { directions.push(direction) },
    verify: async () => false,
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'VERIFY_FAILED')
  assert.equal(result.changeSet.status, 'rolled-back')
  assert.deepEqual(directions, ['apply', 'compensate'])
})

test('apply step failure rolls back and reports APPLY_CONFLICT', async () => {
  const { base, candidate } = candidateForStep()
  const changeSet = createChangeSet({ candidate, baseTopology: base, clock })
  const result = await applyChangeSet({
    changeSet,
    clock,
    execute: async () => { throw new Error('executor down') },
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'APPLY_CONFLICT')
  assert.equal(result.changeSet.status, 'rolled-back')
})

test('compensation failure is reported as ROLLBACK_FAILED', async () => {
  const base = sampleTopology()
  const candidate = {
    id: 'cand-multi',
    actions: [
      { kind: 'reassign', taskId: 't1', toAgent: 'a2' },
      { kind: 'reassign', taskId: 't2', toAgent: 'a1' },
    ],
  }
  const changeSet = createChangeSet({ candidate, baseTopology: base, clock })
  const result = await applyChangeSet({
    changeSet,
    clock,
    execute: async ({ step, direction }) => {
      if (direction === 'apply' && step.stepId === 'step-2') throw new Error('second step failed')
      if (direction === 'compensate') throw new Error('compensation failed')
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'ROLLBACK_FAILED')
  assert.equal(result.changeSet.status, 'failed')
})

test('explicit rollback compensates succeeded steps', async () => {
  const { base, candidate } = candidateForStep()
  const changeSet = createChangeSet({ candidate, baseTopology: base, clock })
  changeSet.steps[0].status = 'succeeded'
  const directions = []
  const result = await rollbackChangeSet({
    changeSet,
    clock,
    execute: async ({ direction }) => { directions.push(direction) },
  })
  assert.equal(result.ok, true)
  assert.equal(result.changeSet.status, 'rolled-back')
  assert.deepEqual(directions, ['compensate'])
})
