import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { JsonlStore } from '../../ace-plugin/adapter/state.js'

test('JsonlStore appends, reads and writes JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ace-store-'))
  try {
    const store = new JsonlStore(dir)
    store.append('runs.jsonl', { id: 1 })
    store.append('runs.jsonl', { id: 2 })
    assert.deepEqual(store.read('runs.jsonl'), [{ id: 1 }, { id: 2 }])
    store.writeJson('state.json', { version: 1 })
    assert.deepEqual(store.readJson('state.json'), { version: 1 })
    assert.equal(existsSync(join(dir, 'state.json')), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
