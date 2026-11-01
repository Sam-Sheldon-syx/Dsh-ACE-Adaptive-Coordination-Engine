# Development

## Requirements

- Node.js >= 24.21.0
- No npm dependencies
- Pure ESM JavaScript (no TypeScript build)

## Commands

```bash
npm test              # 90 tests
npm run test:p8       # same suites via scripts/test-all.mjs; summary written to the OS temp dir
npm run check:syntax  # node --check on core/plugin/scripts/test/experiments
npm run check:package # public boundary: required files, forbidden paths, metadata
npm run check:secrets # basic secret/PII patterns; limited scope
npm run check         # syntax + tests + package + secret checks
```

## Layout

- `core/` — algorithms, no DSH imports.
- `ace-plugin/` — DSH Host-only bundle and adapter.
- `test/core`, `test/adapter`, `test/p7`, `test/faults` — `node:test` suites.
- `experiments/` — deterministic semi-synthetic replay experiment (not a real-task benchmark).
- `docs/` — public documentation.

## Running the experiment

```bash
node experiments/run-p9.mjs
```

It regenerates `experiments/results/` deterministically for the corpus; runtime
measurements vary. The corpus is synthetic and must not be described as real
Python task quality or performance evidence.

## Public boundary

The public tree must not contain:

- real DSH session evidence or session UUIDs;
- local usernames/absolute paths;
- DSH profiles, GUI addresses or credential paths;
- `.credentials*` or any real secrets;
- internal reports, prompts, governance/migration documents;
- patent disclosure/prior-art/innovation materials.

`check:package` and `check:secrets` implement basic checks. They are pattern
scanners, not proof that no sensitive data exists. Never commit real session
exports; use synthetic fixtures.

## Test policy

- Every behavior change should have a test.
- Do not weaken existing tests to make a change pass.
- Keep synthetic fixtures free of personal data.
- Distinguish real DSH environment tests, mock tests and synthetic simulations
  in documentation and reports.

## CI

`.github/workflows/ci.yml` runs tests, syntax, package-boundary and secret scans
on Node 24. It is prepared but has not been executed on GitHub in this phase.
