# Changelog

All notable changes to this public research release are documented here.
The project is experimental; version numbers are pre-release identifiers.

## Runtime-verified adapter fixes — 2026-11-06

- Plugin `0.3.0-p7` → `0.3.3-p7`; project `0.11.0-p10` → `0.11.1-p10`.
- Verified a **live-profile** install through the official `plugin_manager`
  (`install_bundle` with a packed tarball) on DSH 0.2.2-rc.1 / Windows: the
  composed row becomes `active` and `ace_status` appears in the session tool set.
- Fixed: the Host process has no `DSH_SESSION_ID` (that variable belongs to an
  agent's shell), so self-test and status could not resolve a session at all.
  `resolveSessionId` now tries an explicit id, the configured id, the
  environment, the newest live Agent session, then the newest live session.
- Fixed: `ace_status` replayed a recorded evidence file — including a failed
  run — instead of describing the calling session. Evidence is now a fallback
  only, and only when it contains an actual analysis.
- Fixed: the self-test merged every live Host Agent into one session's topology
  and tripped `maxAgents`; only the target session's Agents are admitted, and the
  observed agent count is the budget floor rather than a cap below reality.
- Fixed: the live status path rendered an empty capability table and
  `registered: none`; `capabilities()` is shared and the tool reports itself.
- Fixed: the local tool shim dropped the execution context, so the tool could not
  see its calling agent.
- Added `test/adapter/session-resolution.test.js` (8 regression tests):
  90 → 98 tests.
- Docs: `sessionId` is documented as optional and auto-resolved; supported DSH
  versions now list 0.2.1-rc.2 and 0.2.2-rc.1; the installation guide documents
  the verified `plugin_manager` path and its rollback.

## Publication metadata remediation — 2026-11-02

- Aligned README copyright notices with the MIT LICENSE (`Sam-Sheldon-syx`).
- Added author/repository metadata to both package manifests.
- Documented the AI-generated provenance of `ace-plugin/icon.svg`; no
  third-party logo/asset is included and external similarity was not checked.
- Added bundle-level LICENSE/NOTICE and corrected the public repository URL in
  the installation guide.

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
