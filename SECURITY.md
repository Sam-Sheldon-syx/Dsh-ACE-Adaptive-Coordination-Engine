# Security Policy

## Scope

ACE is an experimental DSH Host-only plugin. It reads session events through
DSH host services and can produce read-only status text. It does not implement
real task-state apply/rollback or Mode L live execution.

## Reporting

Report vulnerabilities through **GitHub Security Advisories** (private
vulnerability reporting) rather than a public issue. Do not include credentials, session exports or personal data in a report.

## Data hygiene

- Never commit `.credentials*`, API keys, tokens, private keys, DSH session
  exports or local machine paths.
- Test fixtures must be synthetic.
- The public tree is checked by `npm run check:package` and
  `npm run check:secrets`; these checks are limited pattern scans, not proof
  that no sensitive data exists.

## Supported versions

Only the version in this repository and the DSH version stated in the README
are tested. No other DSH version or operating system is claimed as supported.
