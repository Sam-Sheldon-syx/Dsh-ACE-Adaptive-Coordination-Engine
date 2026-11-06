# Architecture

## Layers

```text
core/                 Pure ESM JavaScript. No DSH imports.
  model.js            errors, result, canonical JSON, hash, statistics
  config.js           placeholder defaults + merge
  trace.js            session event normalization, metrics, replay summary
  graph.js            topology, canonical hash, bounded impact region
  anomaly.js          hard rules + robust-z signals
  topology.js         reversible actions, constraints, candidate generation
  shadow.js           baseline + Mode R replay; Mode L interface; off
  scoring.js          normalized utility, Pareto, inconclusive
  risk.js             risk levels and fail-closed auto-apply gate
  state.js            ChangeSet apply/verify/compensate
  pipeline.js         analysis orchestration
  index.js            public exports

ace-plugin/           DSH Host-only bundle
  index.js            Cordis plugin entry; tool registration; self-test wiring
  status.js           pure Markdown status renderer
  adapter/trace.js    DSH services -> core events/topology
  adapter/state.js    JSONL/JSON store
  adapter/selftest.js read-only self-test + sandbox rollback + evidence
  adapter/tools.js    read-only ace_status tool
```

The core is deliberately independent of DSH so it can be tested with synthetic
events. The adapter owns all DSH service access and never writes session events.

## Data flow

```text
DSH session events
  → adapter/trace.js (read + map; synthesize step tasks)
  → core trace/topology
  → anomaly detection
  → bounded impact region
  → candidate actions (+ inverse)
  → shadow replay
  → utility + risk gate
  → no-op / approval / ChangeSet apply
```

## ChangeSet transaction

Each candidate becomes a `ChangeSet` with:

- base `version` + topology hash;
- per-step action, inverse action, preconditions;
- status: planned/applying/verifying/committed/rolling-back/rolled-back/failed.

`applyChangeSet` optionally validates `currentTopology` before executing. On
step or verification failure it compensates applied steps in reverse order. If
compensation fails it returns `ROLLBACK_FAILED`; it does not report success.

## Shadow modes

- **Mode R (replay)**: deterministic projection from the trace baseline and
  placeholder coefficients; labelled `simulated`.
- **Mode L (live-fork)**: runner interface only; unavailable without an
  implementation. Fails closed.
- **off**: no confidence; decisions are inconclusive.

## Boundaries

- No DSH source modification.
- No session-event writes.
- No real task-state apply/rollback in the public prototype.
- No claim that the core's placeholder parameters are calibrated.
- Only Windows + DSH 0.2.1-rc.2 / 0.2.2-rc.1 is tested.
