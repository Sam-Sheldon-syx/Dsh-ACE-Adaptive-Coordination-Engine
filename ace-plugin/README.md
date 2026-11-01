# ace-plugin — ACE Host-only bundle

This directory contains the DSH Host-only bundle for ACE.

- `index.js` — plugin entry (`apply(ctx, config)`); synchronously registers tools, then runs optional self-test.
- `status.js` — read-only Markdown status renderer.
- `adapter/trace.js` — reads session events through DSH services and maps them to core trace/topology.
- `adapter/state.js` — JSONL/JSON run records.
- `adapter/selftest.js` — read-only session analysis + sandbox ChangeSet rollback.
- `adapter/tools.js` — registers the read-only `ace_status` tool.

## Configuration

See [../docs/CONFIGURATION.md](../docs/CONFIGURATION.md). Minimal:

```yaml
- id: ace-plugin
  config:
    registerTools: true
    coreDir: '<WORKSPACE>/core'
    sessionId: '<SESSION_ID>'
```

`selfTest` and `registerTools` require `coreDir`. The plugin declares required
host services and will not activate if they are unavailable.

## Boundaries

- Does not modify DSH core.
- Does not write session events.
- `ace_status` is read-only.
- Real task-state apply/rollback is not implemented in this research prototype.
- Only Windows + DSH 0.2.1-rc.2 tested.
