import test from 'node:test'
import assert from 'node:assert/strict'
import { renderStatus, summarizeStatus } from '../../ace-plugin/status.js'

const evidence = {
  stage: 'P7',
  at: '2026-11-01T00:00:00.000Z',
  sessionId: 'sess-1',
  traceSource: 'sessionPersistence.open/read',
  capabilities: { sessions: true, sessionQuery: false },
  trace: { inputEvents: 10, mappedEvents: 8, tasks: 2, toolCalls: 3, failures: 1, tokens: 42 },
  analysis: {
    trace: { eventCount: 10, tasks: 2, agents: 1, latencyMs: 0 },
    anomalies: [{ entity: { kind: 'task', id: 'step:1:1' }, score: 2.5, hardRule: true }],
    impactRegion: { tasks: 2, agents: 1, truncated: false },
    candidates: [{ id: 'cand-1', actions: [{ kind: 'reassign' }] }],
    decision: { kind: 'request-approval', candidateId: 'cand-1', risk: { level: 'high', requiresApproval: true, autoApplyAllowed: false } },
  },
  rollback: { tested: true, result: 'VERIFY_FAILED', status: 'rolled-back', restored: true },
  successApply: { result: 'committed', targetHashMatches: true },
  sessionConsistency: { beforeSeq: 9, afterSeq: 9, liveGrowth: 0, unchangedPrefix: true },
  tools: { registered: ['ace_status'], error: null },
  toolProbe: { ok: true, length: 120 },
  errors: [],
}

test('renders the full status chain', () => {
  const text = renderStatus(evidence)
  for (const heading of ['# ACE Runtime Status', '## 3. Anomalies', '## 5. Candidates', '## 6. Decision', '## 7. Rollback', '## 8. Session consistency']) {
    assert.ok(text.includes(heading), heading)
  }
  assert.ok(text.includes('unchanged prefix'))
  assert.ok(text.includes('ace_status'))
})

test('renders empty evidence without inventing facts', () => {
  const text = renderStatus({})
  assert.ok(text.includes('No anomalies'))
  assert.ok(text.includes('Not tested'))
  assert.ok(text.includes('unknown'))
})

test('summary is bounded', () => {
  const summary = summarizeStatus(evidence)
  assert.equal(summary.sessionId, 'sess-1')
  assert.equal(summary.anomalies, 1)
  assert.equal(summary.decision, 'request-approval')
  assert.equal(summary.rollback, 'VERIFY_FAILED')
  assert.equal(summary.unchangedPrefix, true)
})
