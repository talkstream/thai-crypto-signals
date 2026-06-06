# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately via
[GitHub Security Advisories](https://github.com/talkstream/thai-crypto-signals/security/advisories/new).
Do **not** open a public issue for security problems.

We aim to acknowledge reports within 72 hours.

## Scope & posture

- Thai Crypto Signals collects **public** market data from the official Bitkub API.
  It stores **no** user data and holds **no** Bitkub API credentials (public endpoints
  require none).
- Secrets (only relevant to the future signal-delivery phase) are managed via
  `wrangler secret` / Cloudflare Secrets Store and are never committed. Local overrides
  live in `.dev.vars` (git-ignored).
- CI uses pinned (SHA-pinned) GitHub Actions and a least-privilege `GITHUB_TOKEN`.

## Not financial advice

This project provides informational market data only. See the disclaimer in the README.
