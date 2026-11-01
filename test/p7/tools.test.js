import test from 'node:test'
import assert from 'node:assert/strict'
import { registerAceTools } from '../../ace-plugin/adapter/tools.js'
import * as core from '../../core/index.js'

test('registers ace_status when tools service and defineTool exist', async () => {
  const registered = []
  const ctx = {
    tools: {
      register(tool) {
        registered.push(tool)
        return () => {}
      },
    },
  }
  const defineTool = (definition) => ({ ...definition, __defined: true })
  const info = await registerAceTools({
    ctx,
    config: { coreDir: 'unused', analysisConfig: {} },
    core,
    defineTool,
  })
  assert.deepEqual(info.registered, ['ace_status'])
  assert.equal(info.error, null)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'ace_status')
})

test('fails closed when ctx.tools is unavailable', async () => {
  const info = await registerAceTools({ ctx: {}, config: {}, core })
  assert.deepEqual(info.registered, [])
  assert.match(info.error, /tools/)
})
