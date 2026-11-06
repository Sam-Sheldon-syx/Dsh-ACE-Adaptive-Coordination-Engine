/**
 * Status tools: register a read-only `ace_status` tool when ctx.tools is
 * available. Registration is synchronous so it happens before async wiring;
 * the tool lazily imports core only when executed.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getService, readDshSession, mapDshEvents, resolveSessionId, capabilities } from './trace.js'
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
    async execute(args = {}, exec = {}) {
      return options.execute(args, exec)
    },
  }
}

async function analyzeCurrent({ ctx, config, sessionId }) {
  if (!config.coreDir) throw new Error('coreDir is required when no evidence exists')
  const core = await import(pathToFileURL(join(config.coreDir, 'index.js')).href)
  const sid = await resolveSessionId(ctx, config, sessionId)
  if (!sid) throw new Error('no live DSH session could be resolved; pass sessionId')
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
    capabilities: capabilities(ctx),
    trace: mapped.stats,
    analysis,
    // A live analysis runs inside the registered tool, so it reports itself.
    tools: { registered: ['ace_status'], error: null },
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
    async execute(args = {}, exec = {}) {
      const callingSessionId = exec?.agent?.session?.id
      const explicit = args.sessionId ?? callingSessionId
      // Recorded evidence is only a fallback: a failed run leaves no analysis,
      // and a tool called from an agent must describe that live session.
      let evidence = null
      if (!explicit && config.evidenceFile && existsSync(config.evidenceFile)) {
        try {
          const parsed = JSON.parse(readFileSync(config.evidenceFile, 'utf8'))
          if (parsed && parsed.analysis) evidence = parsed
        } catch {
          evidence = null
        }
      }
      if (!evidence) {
        evidence = await analyzeCurrent({ ctx, config, sessionId: explicit })
      }
      return renderStatus(evidence)
    },
  })

  const dispose = tools.register(tool)
  return { registered: ['ace_status'], error: null, tool, dispose }
}
