/**
 * ACE (Adaptive Coordination Engine) — DSH Host-only plugin entry.
 *
 * Wires the read-only runtime adapter/status tooling to the pure-JS core.
 * This file contains no ACE algorithm; algorithms live in core/.
 *
 * Config (all optional):
 *   probeFile: absolute path; when set, observations are appended as JSON lines.
 *   createAgentProbe: test-only; try to create and dispose one probe Agent.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerAceTools } from './adapter/tools.js'

export const name = 'ace-plugin'
export const version = '0.3.0-p7'
export const inject = ['tools', 'sessions', 'sessionPersistence', 'agents', 'sessionProjections']

const PLUGIN = 'ace-plugin'

function emit(config, event, extra = {}) {
  const file = config && typeof config.probeFile === 'string' ? config.probeFile : ''
  if (!file) return
  const record = {
    plugin: PLUGIN,
    event,
    at: new Date().toISOString(),
    pid: process.pid,
    ...extra,
  }
  try {
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify(record) + '\n')
  } catch {
    // Probe failures must never break plugin activation.
  }
}

async function withService(ctx, name, fn, timeoutMs = 800) {
  if (typeof ctx?.inject !== 'function') {
    try {
      return await fn(ctx)
    } catch (error) {
      return { registered: [], error: String(error?.message ?? error), tool: null }
    }
  }
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve({ registered: [], error: `${name} service unavailable`, tool: null })
    }, timeoutMs)
    try {
      ctx.inject([name], async (scoped) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          resolve(await fn(scoped))
        } catch (error) {
          resolve({ registered: [], error: String(error?.message ?? error), tool: null })
        }
      })
    } catch (error) {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ registered: [], error: String(error?.message ?? error), tool: null })
      }
    }
  })
}

/**
 * Host plugin entry. Cordis calls it once when the loader row is applied.
 * @param {object} ctx Cordis context.
 * @param {object} config Row config.
 */
export async function apply(ctx, config = {}) {
  emit(config, 'apply', { version })

  // Register synchronously while the plugin context is active.
  let toolsInfo = null
  if (config.registerTools === true) {
    try {
      toolsInfo = registerAceTools({ ctx, config })
      emit(config, 'tools-registered', {
        registered: toolsInfo.registered,
        error: toolsInfo.error,
      })
    } catch (error) {
      toolsInfo = { registered: [], error: String(error?.message ?? error), tool: null }
      emit(config, 'tools-error', { message: toolsInfo.error })
    }
  }

  try {
    ctx.logger?.info?.('ace-plugin: apply')
  } catch {
    // Logging is optional.
  }

  // Minimal Hook: observe a documented Agent lifecycle event.
  // ctx.on is owned by this plugin's fiber and is removed on unload.
  if (typeof ctx.on === 'function') {
    try {
      ctx.on('agent/created', (payload) => {
        emit(config, 'agent/created', {
          payloadKeys:
            payload && typeof payload === 'object'
              ? Object.keys(payload).slice(0, 12)
              : [],
        })
      })
    } catch (error) {
      emit(config, 'hook-error', { message: String(error && error.message ? error.message : error) })
    }
  }

  // Test-only runtime probe: proves the loader keeps running plugin code after
  // activation. unref() keeps this from holding a CLI boot open by itself.
  try {
    const timer = setTimeout(() => emit(config, 'timer', { afterMs: 1000 }), 1000)
    timer.unref?.()
  } catch {
    // Timers are optional.
  }

  // Test-only Agent probe: exercises the experimental Agent service if mounted.
  if (config.createAgentProbe === true) {
    const runProbe = (scoped) => {
      try {
        const agents = scoped && scoped.agents
        if (!agents || typeof agents.create !== 'function') {
          emit(config, 'agent-probe-skipped', { reason: 'agents.create unavailable' })
          return
        }
        Promise.resolve()
          .then(() => agents.create({}))
          .then(async (handle) => {
            emit(config, 'agent-probe-created', {
              id: handle?.id ?? handle?.agent?.id ?? 'unknown',
            })
            if (handle && typeof handle.dispose === 'function') {
              await handle.dispose()
              emit(config, 'agent-probe-disposed')
            }
          })
          .catch((error) => {
            emit(config, 'agent-probe-error', {
              message: String(error && error.message ? error.message : error),
            })
          })
      } catch (error) {
        emit(config, 'agent-probe-throw', {
          message: String(error && error.message ? error.message : error),
        })
      }
    }
    try {
      if (typeof ctx.inject === 'function') {
        ctx.inject(['agents'], (scoped) => runProbe(scoped))
      } else {
        runProbe(ctx)
      }
    } catch (error) {
      emit(config, 'agent-probe-inject-error', {
        message: String(error && error.message ? error.message : error),
      })
    }
  }

  // Load core once when the profile opts into runtime wiring.
  let core = null
  if (config.selfTest === true || config.registerTools === true) {
    try {
      if (!config.coreDir) throw new Error('coreDir is required for selfTest/registerTools')
      core = await import(pathToFileURL(join(config.coreDir, 'index.js')).href)
    } catch (error) {
      emit(config, 'core-load-error', {
        message: String(error && error.message ? error.message : error),
      })
    }
  }

  // P6 self-test: only when explicitly enabled by a test profile.
  let evidence = null
  if (config.selfTest === true && core) {
    try {
      const { runSelfTest } = await import('./adapter/selftest.js')
      evidence = await runSelfTest({ ctx, config, core })
      emit(config, 'selftest-done', {
        ok: (evidence.errors ?? []).length === 0,
        decision: evidence.analysis?.decision?.kind ?? null,
        traceEvents: evidence.trace?.inputEvents ?? null,
        rollback: evidence.rollback?.result ?? null,
        unchangedPrefix: evidence.sessionConsistency?.unchangedPrefix ?? null,
      })
    } catch (error) {
      emit(config, 'selftest-error', {
        message: String(error && error.message ? error.message : error),
      })
    }
  }

  // Probe the registered tool against the evidence/real session.
  if (evidence && config.evidenceFile) {
    evidence.tools = toolsInfo
      ? { registered: toolsInfo.registered, error: toolsInfo.error }
      : { registered: [], error: 'registerTools disabled' }
    if (toolsInfo?.tool) {
      try {
        const text = await toolsInfo.tool.execute({})
        evidence.toolProbe = { ok: true, length: text.length, preview: text.slice(0, 600) }
      } catch (error) {
        evidence.toolProbe = { ok: false, message: String(error?.message ?? error) }
      }
    }
    try {
      mkdirSync(dirname(config.evidenceFile), { recursive: true })
      writeFileSync(config.evidenceFile, JSON.stringify(evidence, null, 2) + '\n')
    } catch (error) {
      emit(config, 'evidence-update-error', {
        message: String(error && error.message ? error.message : error),
      })
    }
  }
}
