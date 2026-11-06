# Configuration

All fields are optional at the plugin layer, but `selfTest`/`registerTools`
require `coreDir` when enabled. Paths must be absolute at runtime; this
document uses placeholders only.

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `probeFile` | string | `''` | JSONL file for load/tool/self-test events |
| `createAgentProbe` | boolean | `false` | Test-only agent factory probe |
| `selfTest` | boolean | `false` | Read one session, run core analysis, sandbox rollback, write evidence |
| `registerTools` | boolean | `false` | Register the read-only `ace_status` tool |
| `sessionId` | string | auto | Session used by self-test/status; when unset it falls back to env `DSH_SESSION_ID`, then the newest live Agent session |
| `coreDir` | string | — | Absolute path to `core/` (dynamic import) |
| `evidenceFile` | string | — | Evidence JSON path for self-test |
| `stateDir` | string | — | JSONL run-record directory |
| `analysisConfig` | object | `{}` | Core analysis options (`shadowMode`, `autoApply`, `maxCandidates`, ...) |
| `stage` | string | `public` | Evidence stage marker |

## Required DSH services

The plugin declares:

- `tools`
- `sessions`
- `sessionPersistence`
- `agents`
- `sessionProjections`

If any required service is unavailable, the plugin does not activate. This is
intentional: the adapter cannot fabricate session/tool capabilities.

## Example

```yaml
- id: ace-plugin
  config:
    probeFile: '<WORKSPACE>/logs/ace-probe.jsonl'
    selfTest: false
    registerTools: true
    # sessionId: '<SESSION_ID>'  # optional; resolved automatically when unset
    coreDir: '<WORKSPACE>/core'
    evidenceFile: '<WORKSPACE>/logs/ace-evidence.json'
    stateDir: '<WORKSPACE>/logs/ace-state'
    analysisConfig:
      shadowMode: replay
      autoApply: false
      maxCandidates: 5
```

## Core analysis defaults

These are **uncalibrated placeholders**, not validated optimums:

| Parameter | Default |
| --- | --- |
| weights | quality 0.4 / latency 0.2 / tokens 0.2 / risk 0.2 / reconfig 0.05 |
| anomaly threshold | 1.0 |
| `zMax` | 6 |
| `splitTokens` | 1200 |
| `inconclusiveDelta` | 0.02 |
| `maxCandidates` | 5 |
| `maxAgentDelta` | 2 |
| `maxHops` | 2 |
| `regionMaxNodes` | 24 |
| shadow mode | `replay` |
| autoApply | `false` |

`autoApply` remains false by default. The core only allows automatic application
when evidence confidence is `observed-limited`, risk is low and the switch is
explicitly enabled; otherwise it requests approval or does nothing.

## Paths and secrets

- Do not put real credentials, session exports or local usernames in committed
  configuration.
- `examples/ace.patch.example.yml` uses placeholders; replace them at runtime.
- `probeFile`, `evidenceFile` and `stateDir` produce runtime data; keep them
  outside the repository or ignore them in git.
