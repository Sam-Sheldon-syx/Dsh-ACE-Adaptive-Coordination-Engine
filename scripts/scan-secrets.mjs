#!/usr/bin/env node
/**
 * Basic secret/PII scan for the public tree.
 * Scope is intentionally limited: regex patterns, not a full secret scanner.
 * It never prints the matched value, only file/line/rule.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const skipDirs = new Set(['node_modules', '.git', 'test/p8'])
const textExt = new Set(['.md', '.js', '.mjs', '.json', '.jsonl', '.csv', '.log', '.yml', '.yaml', '.txt', '.svg', '.gitignore', ''])
const rules = [
  { id: 'windows-user-path', re: /C:\\Users\\[^\\\s]+/i },
  { id: 'session-id', re: /\bsession-[0-9a-f]{8,32}\b/i },
  { id: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { id: 'github-token', re: /\b(ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/ },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'credentials-file', re: /\.credentials\.ya?ml/i },
  { id: 'internal-material-marker', re: /(PATENT_DISCLOSURE|PRIOR_ART_REPORT|INNOVATION_SUMMARY|ACE_STATUS|P2_DSH_PROMPT|DSH_PROJECT_GOVERNANCE|ACE_CONTEXT_MIGRATION)/ },
]

const files = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = relative(root, full).split(sep).join('/')
    if (skipDirs.has(rel) || skipDirs.has(name)) continue
    if (statSync(full).isDirectory()) walk(full)
    else files.push(full)
  }
}
walk(root)

const findings = []
let scanned = 0
let skipped = 0
for (const file of files) {
  const rel = relative(root, file).split(sep).join('/')
  if (rel === 'scripts/scan-secrets.mjs' || rel === 'scripts/check-package.mjs') continue
  if (!textExt.has(extname(file)) && !file.endsWith('.gitignore')) { skipped += 1; continue }
  let text
  try { text = readFileSync(file, 'utf8') } catch { skipped += 1; continue }
  scanned += 1
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    for (const rule of rules) {
      if (rule.re.test(lines[i])) findings.push({ file: rel, line: i + 1, rule: rule.id })
    }
  }
}

console.log(`secret-scan ${scanned} scanned, ${skipped} skipped, ${findings.length} finding(s)`)
for (const finding of findings) console.log(`${finding.file}:${finding.line} ${finding.rule}`)
if (findings.length > 0) {
  console.error('secret-scan FAILED: remove or replace the matched data (values are not printed)')
  process.exit(1)
}
console.log('secret-scan OK')
