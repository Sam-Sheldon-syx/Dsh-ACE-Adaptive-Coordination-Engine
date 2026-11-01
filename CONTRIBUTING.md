# Contributing

Thanks for considering a contribution. This is an experimental research
prototype, so small, tested changes are preferred over large rewrites.

## Ground rules

- Do not change the accepted core algorithm semantics without a separate design
  discussion and tests.
- Keep the core (`core/`) free of DSH imports; DSH-specific code belongs in
  `ace-plugin/`.
- Do not add runtime dependencies without prior discussion.
- Do not add real DSH session logs, credentials, local paths or personal data to
  tests, docs or fixtures.
- Add or update a test for every behavior change.

## Development

```bash
npm test
npm run check
```

The public package must not contain `reports/`, real session evidence,
environment reports, patent materials or internal prompts; `npm run
check:package` and `npm run check:secrets` enforce the basic boundary.

## Pull requests

- Describe the problem, the change and the validation performed.
- Keep commits focused; do not mix formatting-only changes with behavior changes.
- Report known limitations instead of hiding them.

## Security

Do not open a public issue for a vulnerability. Follow [SECURITY.md](./SECURITY.md).
