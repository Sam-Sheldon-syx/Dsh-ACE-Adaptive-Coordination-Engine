import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as core from '../../core/index.js'
import { runSelfTest } from '../../ace-plugin/adapter/selftest.js'
import { dshEvents } from './fixtures.js'

test('self-test reads a trace, analyzes, rolls back and preserves session prefix', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ace-selftest-'))
  try {
    const evidenceFile = join(dir, 'evidence.json')
    const ctx = {
      sessionQuery: { readSession: async () => ({ events: dshEvents() }) },
    }
    const evidence = await runSelfTest({
      ctx,
      core,
      config: {
        sessionId: 'sess-1',
        evidenceFile,
        stateDir: join(dir, 'state'),
        analysisConfig: { simulation: { reassignQuality: 0.2, uncertainty: 0.01 } },
      },
    })
    assert.deepEqual(evidence.errors, [])
    assert.equal(evidence.trace.inputEvents, 7)
    assert.equal(evidence.trace.headerEvents, 1)
    assert.ok(evidence.analysis.runId)
    assert.equal(evidence.rollback.tested, true)
    assert.equal(evidence.rollback.result, 'VERIFY_FAILED')
    assert.equal(evidence.rollback.restored, true)
    assert.equal(evidence.sessionConsistency.unchangedPrefix, true)
    assert.ok(readFileSync(evidenceFile, 'utf8').includes('public'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('self-test without coreDir-independent services records an error instead of inventing', async () => {
  const evidence = await runSelfTest({
    ctx: {},
    core,
    config: { sessionId: 'missing', evidenceFile: '' },
  })
  assert.ok(evidence.errors.length > 0)
  assert.equal(evidence.traceSource, null)
})
