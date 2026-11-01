/** Real-shape DSH session events (no conversation text). */
export function dshEvents() {
  const t0 = Date.parse('2026-11-01T00:00:00.000Z')
  const at = (seconds) => new Date(t0 + seconds * 1000).toISOString()
  return [
    { type: 'session', version: 4, id: 'sess-1', createdAt: at(0), cwd: 'C:/work' },
    { seq: 0, time: at(0), type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: {} } },
    { seq: 1, time: at(1), type: 'tool/result', data: { turn: 1, step: 1, callId: 'c1', message: { role: 'tool', isError: true } } },
    { seq: 2, time: at(1), type: 'step/start', data: { turn: 1, step: 1 } },
    { seq: 3, time: at(2), type: 'step/end', data: { turn: 1, step: 1 } },
    { seq: 4, time: at(2), type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, message: {} } },
    { seq: 5, time: at(2), type: 'team/member', data: { version: 1, teamId: 'team-1', member: { id: 'a1', name: 'helper' } } },
  ]
}
