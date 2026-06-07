# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project aims for
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06-07

First released milestone: a production-grade, fully-working Bitkub crypto-rate collector on Cloudflare
Workers, deployed and prod-verified, with a tutorial-grade educational layer. The signals-delivery
layer is present as a dormant, frozen phase-2 scaffold (no delivery yet).

### Added
- **Collector** — server-time-anchored `*/2` collect tick over the Bitkub public API; hourly and daily
  OHLC rollups; daily catalogue refresh + retention maintenance. Integer minor-unit (bigint) money
  math, idempotent atomic commits, KV/D1 hot-cache parity.
- **Read API** — `/health`, `/v1/symbols`, `/v1/tickers/latest`, `/v1/tickers/:symbol` (history),
  `/v1/tickers/:symbol/rollups?interval=1h|1d`.
- **Educational product** — tutorial-grade READMEs in Thai (default), English, and Russian with a
  visible language switcher, plus a Russian case study.
- **Quality & Standards** — 100% coverage of the live production code; a "no module mocks" testing
  doctrine (the network edge is an injected `Fetcher` port exercised by contract-replay of recorded
  real responses; zero `vi.mock`/`vi.spyOn`/`vi.fn`); hexagonal (ports & adapters) architecture; a
  badge cluster + provenance table.
- **Supply-chain / CI** — GitHub Actions verify + deploy; OpenSSF Scorecard and CodeQL workflows;
  all GitHub Actions SHA-pinned; Renovate.

### Fixed
- Production outbound `fetch` regression: the Workers runtime requires `fetch` to be resolved at call
  time inside the handler — a reference captured at module init silently fails outbound subrequests.

### Notes
- **Cost:** at the default cadence (every 2 minutes × ~440 markets) the D1 write volume exceeds the
  free tier, so the workload runs on the Workers **Paid** plan. Queues, KV, cron, and requests fit the
  free tier; a lower cadence and/or fewer markets can keep D1 within the free limit.
- **Phase 2 (planned):** live signal delivery to Telegram, LINE, and webhooks — the producer,
  dispatcher, and notifier scaffolding is in place but disconnected; `SIGNALS_ENABLED` is `false`.

[0.1.0]: https://github.com/talkstream/thai-crypto-signals/releases/tag/v0.1.0
