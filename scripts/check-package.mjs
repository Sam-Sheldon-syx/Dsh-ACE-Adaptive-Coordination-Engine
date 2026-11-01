#!/usr/bin/env node
/**
 * Validate the public package boundary without dependencies.
 * Fails if internal/evidence/patent material or local metadata is present.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const required = [
  'README.md', 'README.en.md', 'LICENSE', 'NOTICE', '.gitignore', 'package.json',
  'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'CHANGELOG.md',
  'docs/INSTALLATION.md', 'docs/CONFIGURATION.md', 'docs/USAGE.md',
  'docs/ARCHITECTURE.md', 'docs/DEVELOPMENT.md',
  '.github/workflows/ci.yml', 'ace-plugin/index.js', 'core/index.js',
]
const forbiddenPath = [
  /(^|\/)reports\//,
  /(^|\/)test\/p[4568]\//,
  /(^|\/)test\/p7\/(?!.*\.test\.js$)/,
  /ACE_STATUS/i,
  /PATENT_DISCLOSURE/i,
  /PRIOR_ART_REPORT/i,
  /INNOVATION_SUMMARY/i,
  /OPEN_SOURCE_READINESS/i,
  /ENVIRONMENT_REPORT/i,
  /API_COMPATIBILITY/i,
  /P2_DSH_PROMPT/i,
  /ACE_CONTEXT_MIGRATION_REPORT/i,
  /DSH_PROJECT_GOVERNANCE/i,
  /PROJECT_PLAN/i,
  /DECISIONS/i,
  /FINAL_AUDIT/i,
  /FINAL_HASHES/i,
]
const contentMarkers = /(PATENT_DISCLOSURE|PRIOR_ART_REPORT|INNOVATION_SUMMARY|ACE_STATUS|P2_DSH_PROMPT|DSH_PROJECT_GOVERNANCE|ACE_CONTEXT_MIGRATION)/
const allowedTop = new Set([
  'README.md', 'README.en.md', 'LICENSE', 'NOTICE', 'CHANGELOG.md', 'CONTRIBUTING.md',
  'SECURITY.md', 'CODE_OF_CONDUCT.md', 'package.json', '.gitignore',
  'core', 'ace-plugin', 'test', 'scripts', 'experiments', 'docs', 'examples', '.github',
])
const files = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue
    const full = join(dir, name)
    const rel = relative(root, full).split('\\').join('/')
    if (statSync(full).isDirectory()) walk(full)
    else files.push(rel)
  }
}
walk(root)

const errors = []
for (const rel of required) if (!existsSync(join(root, rel))) errors.push(`missing required: ${rel}`)
for (const rel of files) {
  const top = rel.split('/')[0]
  if (!allowedTop.has(top)) errors.push(`unexpected top-level entry: ${rel}`)
  for (const pattern of forbiddenPath) if (pattern.test(rel)) errors.push(`forbidden path: ${rel}`)
}

const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (rootPkg.license !== 'MIT') errors.push('package.json license must be MIT')
if (!rootPkg.engines || typeof rootPkg.engines.node !== 'string') errors.push('package.json engines.node missing')
if (!rootPkg.scripts || typeof rootPkg.scripts.test !== 'string') errors.push('package.json scripts.test missing')
if (rootPkg.dependencies && Object.keys(rootPkg.dependencies).length > 0) errors.push('runtime dependencies are not allowed in P12')
if (rootPkg.private !== true) errors.push('package.json should remain private (not published to npm in P12)')
const pluginPkg = JSON.parse(readFileSync(join(root, 'ace-plugin/package.json'), 'utf8'))
if (pluginPkg.license !== 'MIT') errors.push('ace-plugin/package.json license must be MIT')
if (pluginPkg.private !== true) errors.push('ace-plugin/package.json should remain private')

const textFiles = files.filter((rel) => ['.md', '.js', '.mjs', '.json', '.jsonl', '.csv', '.log', '.yml', '.yaml', '.txt', '.svg', ''].includes(extname(rel)))
for (const rel of textFiles) {
  if (rel === 'scripts/check-package.mjs' || rel === 'scripts/scan-secrets.mjs') continue
  const text = readFileSync(join(root, rel), 'utf8')
  if (/C:\\Users\\[^\\\s]+/i.test(text)) errors.push(`local Windows user path in ${rel}`)
  if (/\bsession-[0-9a-f]{8,32}\b/i.test(text)) errors.push(`session id in ${rel}`)
  if (contentMarkers.test(text)) errors.push(`internal material marker in ${rel}`)
}

console.log(`package-check ${files.length} files`)
if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR ${error}`)
  process.exit(1)
}
console.log('package-check OK')
