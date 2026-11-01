/**
 * Status tools: register a read-only `ace_status` tool when ctx.tools is
 * available. Registration is synchronous so it happens before async wiring;
 * the tool lazily imports core only when executed.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getService, readDshSession, mapDshEvents } from './trace.js'
import { renderStatus } from '../status.js'

function defineLocalTool(options) {
  const properties = {}
  for (const [name, spec] of Object.entries(options.parameters ?? {})) {
    properties[name] = { ...spec }
  }
  return {
    name: options.name,
    description: options.description,
    parameters: {
      type: 'object',
      properties,
      ...(Object.keys(properties).length > 0 ? {} : { additionalProperties: false }),
    },
    output: {
      schema: options.output.schema,
      render: options.output.render,
    },
    async execute(args = {}) {
      return options.execute(args)
    },
  }
}

async function analyzeCurrent({ ctx, config, sessionId }) {
  if (!config.coreDir) throw new Error('coreDir is required when no evidence exists')
  const core = await import(pathToFileURL(join(config.coreDir, 'index.js')).href)
  const sid = sessionId ?? config.sessionId ?? process.env.DSH_SESSION_ID
  const before = await readDshSession(ctx, sid)
  const mapped = mapDshEvents(before.events, { sessionId: sid, liveAgentIds: [] })
  const analysis = await core.analyze({
    events: mapped.events,
    topology: mapped.topology,
    sessionId: sid,
    config: config.analysisConfig ?? {},
  })
  return {
    stage: 'public',
    at: new Date().toISOString(),
    sessionId: sid,
    traceSource: before.source,
    trace: mapped.stats,
    analysis,
    errors: [],
  }
}

/**
 * Synchronous registration. `execute` is async and reads evidence or the live
 * session through the same read-only trace adapter.
 * @param {{ctx: object, config: object, defineTool?: Function}} input
 */
export function registerAceTools(input) {
  const { ctx, config } = input
  const tools = getService(ctx, 'tools')
  if (!tools || typeof tools.register !== 'function') {
    return { registered: [], error: 'ctx.tools.register unavailable', tool: null }
  }

  const defineTool = input.defineTool ?? defineLocalTool
  const tool = defineTool({
    name: 'ace_status',
    description: 'Show ACE (Adaptive Coordination Engine) read-only runtime status: trace summary, anomalies, candidates, decision, rollback evidence, session consistency.',
    parameters: {
      sessionId: { type: 'string', description: 'Optional DSH session id; defaults to the configured ACE session.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args = {}) {
      let evidence = null
      if (config.evidenceFile && existsSync(config.evidenceFile)) {
        try {
          evidence = JSON.parse(readFileSync(config.evidenceFile, 'utf8'))
        } catch {
          evidence = null
        }
      }
      if (!evidence || args.sessionId) {
        evidence = await analyzeCurrent({ ctx, config, sessionId: args.sessionId })
      }
      return renderStatus(evidence)
    },
  })

  const dispose = tools.register(tool)
  return { registered: ['ace_status'], error: null, tool, dispose }
}
