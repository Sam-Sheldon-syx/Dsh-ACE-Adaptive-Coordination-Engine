import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolveSessionId, mapDshEvents } from '../../ace-plugin/adapter/trace.js'
import { registerAceTools } from '../../ace-plugin/adapter/tools.js'
import { dshEvents } from './fixtures.js'

/**
 * Regression cover for two runtime defects found while installing the plugin
 * into a live DSH 0.2.2 desktop profile:
 *
 * 1. The Host process has no DSH_SESSION_ID, so every ACE run failed with
 *    "sessionId is required" until a session could be resolved from services.
 * 2. The self-test fed every live Host Agent into one session's topology,
 *    which exceeded the topology's maxAgents budget.
 */

function withoutEnv(fn) {
  const previous = process.env.DSH_SESSION_ID
  delete process.env.DSH_SESSION_ID
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) delete process.env.DSH_SESSION_ID
      else process.env.DSH_SESSION_ID = previous
    })
}

test('resolveSessionId prefers an explicit id', async () => {
  const ctx = { agents: { list: async () => [{ id: 'a1', session: { id: 'live-1' } }] } }
  assert.equal(await resolveSessionId(ctx, { sessionId: 'config-1' }, 'explicit-1'), 'explicit-1')
})

test('resolveSessionId falls back to config, then env', async () => {
  await withoutEnv(async () => {
    assert.equal(await resolveSessionId({}, { sessionId: 'config-1' }), 'config-1')

    const previous = process.env.DSH_SESSION_ID
    process.env.DSH_SESSION_ID = 'env-1'
    try {
      assert.equal(await resolveSessionId({}, {}), 'env-1')
    } finally {
      if (previous === undefined) delete process.env.DSH_SESSION_ID
      else process.env.DSH_SESSION_ID = previous
    }
  })
})

test('resolveSessionId finds the newest live Agent session without env', async () => {
  await withoutEnv(async () => {
    const ctx = {
      agents: {
        list: async () => [
          { id: 'a1', session: { id: 'live-1' } },
          { id: 'a2', session: { id: 'live-2' } },
        ],
      },
    }
    assert.equal(await resolveSessionId(ctx, {}), 'live-2')
  })
})

test('resolveSessionId falls back to the live session registry', async () => {
  await withoutEnv(async () => {
    const ctx = { sessions: { list: async () => [{ id: 's-1' }, { id: 's-2' }] } }
    assert.equal(await resolveSessionId(ctx, {}), 's-2')
  })
})

test('resolveSessionId reports no session instead of inventing one', async () => {
  await withoutEnv(async () => {
    assert.equal(await resolveSessionId({}, {}), null)
  })
})

test('topology budget never undercuts the agents it already has', () => {
  const liveAgentIds = Array.from({ length: 12 }, (_, index) => `live-${index}`)
  const mapped = mapDshEvents(dshEvents(), { sessionId: 'sess-1', liveAgentIds })
  assert.ok(mapped.topology.agents.length > 8)
  assert.equal(mapped.topology.policy.maxAgents, mapped.topology.agents.length)
})

const coreDir = fileURLToPath(new URL('../../core', import.meta.url))

function registerTool(config) {
  const registered = []
  const ctx = {
    tools: { register(tool) { registered.push(tool); return () => {} } },
    sessionQuery: { readSession: async () => ({ events: dshEvents() }) },
  }
  const info = registerAceTools({ ctx, config })
  assert.deepEqual(info.registered, ['ace_status'])
  return info.tool
}

test('ace_status describes the calling session instead of stale evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ace-tool-'))
  try {
    const evidenceFile = join(dir, 'evidence.json')
    writeFileSync(evidenceFile, JSON.stringify({
      stage: 'public',
      sessionId: 'stale-1',
      analysis: { decision: { kind: 'no-op' } },
    }))
    const tool = registerTool({ coreDir, evidenceFile, analysisConfig: {} })
    const text = await tool.execute({}, { agent: { session: { id: 'calling-9' } } })
    assert.match(text, /calling-9/)
    assert.doesNotMatch(text, /stale-1/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ace_status ignores a recorded run that carries no analysis', async () => {
  // The Host may export DSH_SESSION_ID to child processes; this case is about a
  // Host with no resolvable session at all.
  await withoutEnv(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ace-tool-'))
    try {
      const evidenceFile = join(dir, 'evidence.json')
      writeFileSync(evidenceFile, JSON.stringify({
        stage: 'public',
        sessionId: null,
        errors: [{ code: 'SELFTEST_ERROR', message: 'no session' }],
      }))
      const tool = registerTool({ coreDir, evidenceFile, analysisConfig: {} })
      await assert.rejects(() => tool.execute({}), /no live DSH session/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
