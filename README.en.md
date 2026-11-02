# ACE — Adaptive Coordination Engine

> **Experimental research prototype**, not a production tool.
> A Host-only plugin for DeepSeek Harness (DSH) exploring trace-replay-based
> local dynamic reconfiguration of multi-agent collaboration.

## What it does

ACE reconstructs an execution trace from DSH session events, locates a bounded
local anomaly region, generates reversible candidate collaboration topologies,
evaluates them in shadow/replay mode, scores them on quality/latency/tokens/risk,
and evaluates a versioned ChangeSet in a sandbox: verification, compensation and rollback are exercised without real DSH task-state mutation. Real DSH apply/rollback is not implemented.
It does not write the formal DSH task state during shadow analysis.

## Status

- Core algorithms, DSH adapter and read-only `ace_status` tool are implemented.
- **90/90 tests pass** with `node:test`; no runtime dependencies.
- Real DSH task-state apply/rollback and Mode L live shadow are **not implemented**.
- The semi-synthetic replay experiment **does not** demonstrate real-task quality
  or performance improvements.
- Tested only on Windows with DSH 0.2.1-rc.2 and Node.js 24.21.0/24.22.1.

## Requirements

- Node.js >= 24.21.0
- DSH 0.2.1-rc.2 (Windows desktop; other platforms/versions untested)
- No npm dependencies

## Quick start

```bash
npm test
npm run check
```

Plugin installation (isolated DSH profile only; do not use the desktop profile):

1. Copy `ace-plugin/` into `<DSH_HOME>/profiles/<PROFILE>/node_modules/ace-plugin`.
2. Add `ace-plugin` to `dsh.profile.bundles`.
3. Provide a patch overlay (see `docs/CONFIGURATION.md`).
4. Run a boot smoke test: `<DSH_INSTALL>/dsh.cmd --profile <PROFILE> --patch <PATCH_FILE> --help` (`--help` only prints help; a real web/CLI boot is needed to load the plugin).

The `plugin_manager` install path is not verified by this project; the copy
method above is the one used in the project's isolated-profile checks.

## Documentation

- [Installation](docs/INSTALLATION.md)
- [Configuration](docs/CONFIGURATION.md)
- [Usage](docs/USAGE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development](docs/DEVELOPMENT.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

## Limitations

- No real DSH state mutation/rollback, no Mode L execution, no interactive tool
  invocation test.
- Step tasks are synthesized by the adapter, not a formal DSH task graph.
- Metrics such as latency and token accounting are incomplete/placeholder.
- No real-task performance or quality claims.

## License

[MIT](LICENSE) © 2026 Sam-Sheldon-syx.
