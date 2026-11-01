# Usage

## Read-only status tool

When `registerTools: true`, the plugin registers `ace_status`:

```text
ace_status()
ace_status({ sessionId: "<SESSION_ID>" })
```

Without `sessionId`, the tool uses the configured session/evidence and returns
the latest evidence when available; otherwise it reads the session through DSH
services and runs a read-only analysis.

The output includes:

1. Capability probe (sessionQuery/sessionPersistence/agents/tools);
2. Trace counts and failures;
3. Anomaly entities and hard-rule flags;
4. Impact-region size/truncation;
5. Candidate actions;
6. Decision and risk;
7. Scoring/shadow confidence;
8. Sandbox rollback/commit evidence;
9. Session prefix consistency;
10. Tooling registration status.

## Self-test

With `selfTest: true`, plugin activation:

1. reads one configured session through DSH services;
2. maps events to the core trace/topology;
3. runs anomaly/region/candidate/shadow/scoring/risk;
4. runs a **sandbox** ChangeSet success and failure/rollback;
5. compares the session prefix before/after;
6. writes evidence JSON.

It does not write session events or apply changes to real task state.

## Interpreting decisions

| Decision | Meaning |
| --- | --- |
| `no-op` | No candidates or evidence is inconclusive |
| `report-only` | Candidate exists but automatic apply is disabled |
| `request-approval` | Risk/evidence requires human approval |
| `apply` | Only reachable with explicit autoApply + low risk + observed evidence |

The public prototype's default configuration does not enable real application.
The apply path is exercised only against an in-memory sandbox in tests.

## Limitations

- `ace_status` is read-only; it cannot fix or apply a topology.
- Status is a snapshot; re-run or call the tool to refresh.
- Tokens are summed reported usage, not billing; latency may be unavailable.
- Real DSH task-state apply/rollback is not implemented.
- No guarantee of compatibility outside Windows + DSH 0.2.1-rc.2.
