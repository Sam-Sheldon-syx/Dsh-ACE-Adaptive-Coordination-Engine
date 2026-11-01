import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const patterns = [
  'test/core/*.test.js',
  'test/adapter/*.test.js',
  'test/p7/*.test.js',
  'test/faults/*.test.js',
]

const startedAt = new Date().toISOString()
const started = Date.now()
const result = spawnSync(process.execPath, ['--test', ...patterns], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
const summary = {
  command: `node --test ${patterns.map((pattern) => `"${pattern}"`).join(' ')}`,
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - started,
  exitCode: result.status ?? 1,
  status: result.status === 0 ? 'pass' : 'fail',
}
// Keep generated summaries out of the public tree.
const dir = join(tmpdir(), `ace-test-summary-${process.pid}`)
mkdirSync(dir, { recursive: true })
const summaryPath = join(dir, 'test-summary.json')
writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n')
console.log(`test summary: ${summaryPath}`)
process.exit(summary.exitCode)
