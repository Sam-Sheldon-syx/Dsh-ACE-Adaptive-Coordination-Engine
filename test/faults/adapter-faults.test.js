import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readDshSession } from '../../ace-plugin/adapter/trace.js'
import { registerAceTools } from '../../ace-plugin/adapter/tools.js'
import { runSelfTest } from '../../ace-plugin/adapter/selftest.js'
import * as core from '../../core/index.js'
import { dshEvents } from '../adapter/fixtures.js'

test('F-50 missing session services fail with TRACE_UNAVAILABLE', async () => {
  await assert.rejects(readDshSession({}, 'missing'), (error) => error.code === 'TRACE_UNAVAILABLE')
})

test('F-51 malformed session result fails with TRACE_CORRUPT', async () => {
  const ctx = { sessionQuery: { readSession: async () => ({ nope: true }) } }
  await assert.rejects(readDshSession(ctx, 's'), (error) => error.code === 'TRACE_CORRUPT')
})

test('F-52 tools service unavailable returns a closed error', async () => {
  const info = await registerAceTools({ ctx: {}, config: {} })
  assert.deepEqual(info.registered, [])
  assert.match(info.error, /tools/)
})

test('F-53 tool execute without evidence/coreDir fails closed', async () => {
  const ctx = { tools: { register: () => () => {} } }
  const info = registerAceTools({
    ctx,
    config: { evidenceFile: join(tmpdir(), 'ace-missing-evidence.json') },
    defineTool: (definition) => definition,
  })
  await assert.rejects(info.tool.execute({}), /coreDir is required/)
})

test('F-54 evidence write failure is recorded, not thrown', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ace-fault-'))
  try {
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'x')
    const ctx = { sessionQuery: { readSession: async () => ({ events: dshEvents() }) } }
    const evidence = await runSelfTest({
      ctx,
      core,
      config: {
        sessionId: 'sess-1',
        evidenceFile: join(blocker, 'evidence.json'),
      },
    })
    assert.ok(evidence.errors.some((error) => error.code === 'EVIDENCE_WRITE_FAILED'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
