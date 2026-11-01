/** Deterministic synthetic fixtures for ACE core tests. */
export function sampleEvents() {
  const t0 = Date.parse('2026-11-01T00:00:00.000Z')
  const at = (seconds) => new Date(t0 + seconds * 1000).toISOString()
  return [
    { seq: 0, time: at(0), type: 'team/task', data: { taskId: 't1', status: 'running', dependsOn: [], assignee: 'a1', criticality: 'high', expectedTokens: 2000, expectedMs: 1000 } },
    { seq: 1, time: at(0), type: 'team/task', data: { taskId: 't2', status: 'pending', dependsOn: ['t1'], assignee: 'a2', expectedTokens: 500, expectedMs: 500 } },
    { seq: 2, time: at(0), type: 'team/member', data: { agentId: 'a1', kind: 'teammate' } },
    { seq: 3, time: at(0), type: 'team/member', data: { agentId: 'a2', kind: 'teammate' } },
    { seq: 4, time: at(1), type: 'tool/call', data: { taskId: 't1', agentId: 'a1', callId: 'c1' }, taskRef: 't1' },
    { seq: 5, time: at(2), type: 'tool/result', data: { taskId: 't1', agentId: 'a1', callId: 'c1', isError: true } },
    { seq: 6, time: at(2), type: 'llm/retry', data: { taskId: 't1', agentId: 'a1' } },
    { seq: 7, time: at(3), type: 'step/start', data: { taskId: 't1', agentId: 'a1' } },
    { seq: 8, time: at(6), type: 'step/end', data: { taskId: 't1', agentId: 'a1' } },
    { seq: 9, time: at(6), type: 'assistant/message', data: { taskId: 't1', agentId: 'a1', usage: { inputTokens: 100, outputTokens: 50 } } },
    { seq: 10, time: at(6), type: 'team/message/queued', data: { from: 'a1', to: 'a2' } },
  ]
}

export function sampleTopology() {
  return {
    version: 1,
    sessionId: 's1',
    tasks: [
      { id: 't1', title: 'task 1', criticality: 'high', expectedTokens: 2000, expectedMs: 1000 },
      { id: 't2', title: 'task 2', criticality: 'medium', expectedTokens: 500, expectedMs: 500 },
    ],
    agents: [
      { id: 'lead', kind: 'lead' },
      { id: 'a1', kind: 'teammate' },
      { id: 'a2', kind: 'teammate' },
    ],
    dependencies: [{ from: 't1', to: 't2', weight: 1 }],
    coordination: [
      { from: 'lead', to: 'a1', kind: 'delegation', weight: 1 },
      { from: 'a1', to: 'a2', kind: 'message', weight: 1 },
    ],
    assignments: [
      { taskId: 't1', agentId: 'a1' },
      { taskId: 't2', agentId: 'a2' },
    ],
    policy: { maxAgents: 8, maxParallel: 4 },
  }
}
