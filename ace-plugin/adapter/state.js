/** Minimal JSONL/JSON store for ACE state and run records (P6 adapter). */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export class JsonlStore {
  constructor(dir) {
    if (!dir) throw new Error('state dir is required')
    this.dir = dir
  }

  path(name) {
    return join(this.dir, name)
  }

  append(name, record) {
    const file = this.path(name)
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify(record) + '\n')
    return file
  }

  read(name) {
    const file = this.path(name)
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  }

  writeJson(name, value) {
    const file = this.path(name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
    return file
  }

  readJson(name) {
    const file = this.path(name)
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8'))
  }
}
