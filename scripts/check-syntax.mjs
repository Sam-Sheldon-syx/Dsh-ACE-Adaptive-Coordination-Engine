#!/usr/bin/env node
/** Syntax-check every JavaScript/ESM file in the public tree. No dependencies. */
import { readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const roots = ['core', 'ace-plugin', 'scripts', 'test', 'experiments']
const files = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full)
    else if (/\.(mjs|js)$/.test(name)) files.push(full)
  }
}

for (const dir of roots) walk(join(root, dir))
const failures = []
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (result.status !== 0) failures.push({ file: relative(root, file), output: result.stderr })
}

console.log(`syntax-checked ${files.length} files`)
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure.file}\n${failure.output}`)
  process.exit(1)
}
console.log('syntax-check OK')
