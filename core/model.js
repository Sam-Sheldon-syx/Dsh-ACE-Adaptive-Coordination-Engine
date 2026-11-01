/**
 * Shared primitives for the ACE core.
 * Pure JavaScript; no DSH APIs. Uses node:crypto only for stable hashing.
 */
import { createHash } from 'node:crypto'

export class AceError extends Error {
  /**
   * @param {string} code stable error code (see ACE_INTERFACES §9)
   * @param {string} message human readable
   * @param {{retryable?: boolean, detail?: object}} [options]
   */
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'AceError'
    this.code = code
    this.retryable = options.retryable === true
    this.detail = options.detail
  }
}

/** @template T @param {T} value */
export function ok(value) {
  return { ok: true, value }
}

/**
 * @param {string} code
 * @param {string} message
 * @param {object} [detail]
 */
export function err(code, message, detail) {
  return { ok: false, error: new AceError(code, message, { detail }) }
}

export function assert(condition, code, message) {
  if (!condition) throw new AceError(code, message)
}

/** Deterministic JSON: object keys sorted, arrays preserved. */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value))
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key])
    return out
  }
  return value
}

/** SHA-256 hex over canonical JSON. */
export function hashOf(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function mean(values) {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Median absolute deviation. */
export function mad(values) {
  const m = median(values)
  if (m === null) return null
  return median(values.map((value) => Math.abs(value - m)))
}

export function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Deep clone for plain JSON-like data. */
export function clone(value) {
  return structuredClone(value)
}
