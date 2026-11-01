# Changelog

All notable changes to this public research release are documented here.
The project is experimental; version numbers are pre-release identifiers.

## Public release preparation — 2026-11-01

- Added a sanitized GitHub release tree: core, plugin, tests, synthetic replay data,
  public docs, MIT license, NOTICE, issue/PR templates and CI.
- No runtime dependencies; versions remain `0.11.0-p10` (project) and
  `0.3.0-p7` (plugin) as internal pre-release identifiers; the public repository
  is source-only, not published to npm (`private: true`).
- Real DSH task-state apply/rollback, Mode L and interactive tool invocation are
  not claimed as implemented.

## [0.11.0-p10] — 2026-11-01

### Added

- Pure ESM JavaScript ACE core: trace normalization, topology/impact region,
  anomaly detection, reversible candidate actions, shadow replay, scoring,
  risk gating, versioned ChangeSet transactions and analysis pipeline.
- DSH Host-only plugin: session persistence adapter, sandbox self-test and
  read-only `ace_status` tool.
- 90 `node:test` tests: core, adapter, status/tool and fault-injection suites.
- Deterministic semi-synthetic replay experiment and raw result data.
- Public documentation, MIT license, local package/secret checks and CI workflow.

### Notes

- Experimental research prototype; not production-ready.
- Verified only on Windows with DSH 0.2.1-rc.2.
- Real DSH task-state apply/rollback and Mode L live shadow are not implemented.
- Replay results are semi-synthetic and cannot be generalized to real task quality.
