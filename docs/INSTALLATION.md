# Installation

## Requirements

- Windows 10/11 (the only tested OS)
- Node.js **>= 24.21.0** for tests and tooling
- DeepSeek Harness **0.2.1-rc.2** (Windows desktop; other versions untested)
- No npm runtime dependencies

> Do not install this plugin into your daily `desktop` profile for experiments.
> Use an isolated profile and remove it after verification.

## 1. Get the source

```bash
git clone https://github.com/Sam-Sheldon-syx/ACE-Adaptive-Coordination-Engine.git
cd ACE-Adaptive-Coordination-Engine
```

If the repository is downloaded as an archive, use the extracted directory. The public repository is at `https://github.com/Sam-Sheldon-syx/ACE-Adaptive-Coordination-Engine`.

## 2. Run tests and checks (no DSH needed)

```bash
npm test
npm run check
```

Expected: 90 tests pass, syntax/package/secret checks pass.

## 3. Create an isolated DSH profile

Use the DSH CLI/profile mechanism available in your installation. A profile
contains its own `package.json` with a `dsh.profile.bundles` list. A minimal
example:

```json
{
  "name": "dsh-profile-ace",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "ace-plugin"
      ]
    }
  }
}
```

Do not modify the `desktop` profile for these experiments.

## 4. Copy the plugin bundle

Copy the repository's `ace-plugin/` directory to:

```text
<DSH_HOME>/profiles/<PROFILE>/node_modules/ace-plugin
```

`<DSH_HOME>` is the DSH data directory, not this repository. The plugin reads
`core/` via `coreDir` at runtime; keep the repository path available or point
`coreDir` to it.

## 5. Add config overlay

Create a patch file based on [examples/ace.patch.example.yml](../examples/ace.patch.example.yml):

```yaml
- id: ace-plugin
  config:
    probeFile: '<WORKSPACE>/logs/ace-probe.jsonl'
    selfTest: true
    registerTools: true
    sessionId: '<SESSION_ID>'
    coreDir: '<WORKSPACE>/core'
    evidenceFile: '<WORKSPACE>/logs/ace-evidence.json'
    stateDir: '<WORKSPACE>/logs/ace-state'
```

Replace every placeholder. Never commit real paths, session IDs or evidence.

## 6. Start and verify

```text
<DSH_INSTALL>/dsh.cmd --profile <PROFILE> --patch <PATCH_FILE> --help
```

`--help` is a boot smoke test: it prints help and exits. It does not load a
running web/CLI session. `dsh.cmd` is normally not on PATH; use the launcher in
the DSH installation. For a real load, start DSH normally with this profile and
patch, then inspect the probe/evidence files.

Then check:

- `<WORKSPACE>/logs/ace-probe.jsonl` contains an `apply` event;
- with `selfTest: true`, the evidence file is written;
- with `registerTools: true`, a `tools-registered` event is present.

## 7. Remove the test profile

After verification, delete the isolated profile and its test data. Do not leave
it enabled in daily use.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Plugin not loaded | Bundle not listed, or required DSH service missing |
| `sessionQuery` unavailable | Base profile uses `openAt: never`; adapter falls back to `sessionPersistence` |
| `ace_status` missing | `registerTools` false or tools service unavailable |
| Evidence not written | `evidenceFile` path missing/unwritable |
| `coreDir` import error | `coreDir` must be the `core/` directory (the code appends `index.js`), e.g. `<WORKSPACE>/core` |

These are the conditions observed in the project's isolated-profile tests; other DSH
versions/configurations may behave differently.
