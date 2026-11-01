/**
 * Versioned topology changes: ChangeSet construction, apply, verify, rollback.
 * Executes actions only through an injected executor; core never touches DSH.
 */
import { AceError, assert, clone, hashOf } from './model.js'
import { applyAction, inverseOf, validateTopology } from './topology.js'
import { topologyHash } from './graph.js'

/**
 * Build a transaction from a candidate, capturing inverse actions against the
 * exact topology state each step will see.
 * @param {{candidate: object, baseTopology: object, clock?: () => string}} input
 */
export function createChangeSet(input) {
  const { candidate, baseTopology } = input
  assert(candidate && Array.isArray(candidate.actions), 'CONFIG_INVALID', 'candidate.actions is required')
  const clock = input.clock ?? (() => new Date().toISOString())
  const steps = []
  let current = clone(baseTopology)

  candidate.actions.forEach((action, index) => {
    const inverse = inverseOf(current, action)
    assert(inverse, 'CONFIG_INVALID', `no inverse available for action ${action.kind}`)
    const next = applyAction(current, action)
    steps.push({
      stepId: `step-${index + 1}`,
      action,
      inverse,
      preconditions: [`baseVersion:${current.version}`, `topologyHash:${current.hash}`],
      status: 'planned',
      evidence: [],
      startedAt: null,
      endedAt: null,
    })
    current = next
  })

  const problems = validateTopology(current)
  assert(problems.length === 0, 'CONFIG_INVALID', `candidate topology invalid: ${problems.join('; ')}`)

  const idHash = hashOf({
    candidateId: candidate.id,
    base: baseTopology.hash,
    target: current.hash,
    actions: candidate.actions,
  })
  return {
    id: `cs-${idHash.slice(0, 16)}`,
    baseVersion: baseTopology.version,
    baseTopologyHash: baseTopology.hash,
    targetTopologyHash: current.hash,
    targetTopology: current,
    steps,
    status: 'planned',
    createdAt: clock(),
  }
}

/**
 * Execute a ChangeSet through injected callbacks.
 * @param {{
 *   changeSet: object,
 *   execute: (payload: { step: object, direction: 'apply'|'compensate' }) => any,
 *   verify?: (changeSet: object) => boolean | Promise<boolean>,
 *   clock?: () => string,
 * }} input
 */
export async function applyChangeSet(input) {
  const clock = input.clock ?? (() => new Date().toISOString())
  const changeSet = clone(input.changeSet)

  // Fail closed before touching the executor if the base moved.
  if (input.currentTopology) {
    const current = input.currentTopology
    const currentHash = current.hash ?? topologyHash(current)
    const versionMismatch = current.version !== changeSet.baseVersion
    const hashMismatch = changeSet.baseTopologyHash !== undefined && currentHash !== changeSet.baseTopologyHash
    if (versionMismatch || hashMismatch) {
      changeSet.status = 'failed'
      return {
        ok: false,
        changeSet,
        error: new AceError('APPLY_CONFLICT', 'base topology changed before apply', {
          detail: {
            expectedVersion: changeSet.baseVersion,
            currentVersion: current.version,
            expectedHash: changeSet.baseTopologyHash,
            currentHash,
          },
        }),
      }
    }
  }

  changeSet.status = 'applying'
  const applied = []

  try {
    for (const step of changeSet.steps) {
      step.status = 'running'
      step.startedAt = clock()
      try {
        await input.execute({ step, direction: 'apply' })
      } catch (error) {
        step.status = 'failed'
        step.endedAt = clock()
        step.evidence.push({ kind: 'apply-step', ref: `${changeSet.id}:${step.stepId}:error` })
        return await failWithRollback(changeSet, applied, input, clock, new AceError(
          'APPLY_CONFLICT',
          `apply step failed: ${step.stepId}`,
          { detail: { cause: String(error?.message ?? error) } },
        ))
      }
      step.status = 'succeeded'
      step.endedAt = clock()
      step.evidence.push({ kind: 'apply-step', ref: `${changeSet.id}:${step.stepId}` })
      applied.push(step)
    }

    changeSet.status = 'verifying'
    if (typeof input.verify === 'function') {
      const verified = await input.verify(changeSet)
      if (verified !== true) {
        return await failWithRollback(changeSet, applied, input, clock, new AceError(
          'VERIFY_FAILED',
          'post-apply verification failed',
        ))
      }
    }

    changeSet.status = 'committed'
    return { ok: true, changeSet, topology: changeSet.targetTopology }
  } catch (error) {
    return await failWithRollback(changeSet, applied, input, clock, error)
  }
}

async function failWithRollback(changeSet, applied, input, clock, originalError) {
  changeSet.status = 'rolling-back'
  let rollbackFailed = false
  for (const step of [...applied].reverse()) {
    try {
      await input.execute({ step, direction: 'compensate' })
      step.status = 'compensated'
      step.evidence.push({ kind: 'apply-step', ref: `${changeSet.id}:${step.stepId}:compensated` })
    } catch (error) {
      step.status = 'compensation-failed'
      step.evidence.push({
        kind: 'apply-step',
        ref: `${changeSet.id}:${step.stepId}:compensation-failed`,
      })
      rollbackFailed = true
      void error
    }
  }
  if (rollbackFailed) {
    changeSet.status = 'failed'
    return {
      ok: false,
      changeSet,
      error: new AceError('ROLLBACK_FAILED', 'rollback failed; manual intervention required', {
        detail: { original: originalError?.code },
      }),
    }
  }
  changeSet.status = 'rolled-back'
  return {
    ok: false,
    changeSet,
    error: originalError instanceof AceError
      ? originalError
      : new AceError('APPLY_CONFLICT', String(originalError?.message ?? originalError)),
  }
}

/**
 * Explicit rollback of a committed/partially applied change set.
 * @param {{changeSet: object, execute: Function, clock?: () => string}} input
 */
export async function rollbackChangeSet(input) {
  const clock = input.clock ?? (() => new Date().toISOString())
  const changeSet = clone(input.changeSet)
  const applied = [...changeSet.steps].filter((step) => step.status === 'succeeded').reverse()
  changeSet.status = 'rolling-back'
  let failed = false
  for (const step of applied) {
    try {
      await input.execute({ step, direction: 'compensate' })
      step.status = 'compensated'
      step.endedAt = clock()
    } catch {
      step.status = 'compensation-failed'
      failed = true
    }
  }
  if (failed) {
    changeSet.status = 'failed'
    return {
      ok: false,
      changeSet,
      error: new AceError('ROLLBACK_FAILED', 'rollback failed; manual intervention required'),
    }
  }
  changeSet.status = 'rolled-back'
  return { ok: true, changeSet }
}
