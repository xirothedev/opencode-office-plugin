# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| Latest `vX.Y.Z` release on npm | ✅ |
| Older releases | Best effort — please upgrade and retest |

## Reporting a vulnerability

Email **lethanhtrung.trungle@gmail.com** with:

- Affected version / tag and reproduction steps
- Impact and any proof of concept
- Your contact for follow-up

Please do not open a public issue for unconfirmed vulnerabilities.

## What to expect

- Acknowledgement within 72 hours.
- Fix coordinated privately, then released via the normal `vX.Y.Z` tag
  pipeline with a changelog entry crediting the reporter (unless anonymous).
- This plugin stores data locally by default
  (see `docs/adr/0014-runtime-captures-local-only.md`); include relevant
  local redacted logs only, never credentials or customer documents.
