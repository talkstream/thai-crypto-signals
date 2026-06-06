# Thai Crypto Signals

A small, stable collector of cryptocurrency rates from the official
[Bitkub](https://www.bitkub.com) public API, running on **Cloudflare Workers**.
It snapshots every traded THB market once per cadence into a queryable store and
exposes a tiny read API. It is built as a clean foundation for **signals /
notifications** (Telegram, webhooks) — that layer is scaffolded but dark in v1.

> **Not financial advice.** This project provides informational market data only.
> Technical indicators have mixed empirical support; past performance does not
> predict future results. Nothing here is a buy/sell recommendation.

**Live:** `https://thai-crypto-signals.mommyslittlehelper.workers.dev` — try
[`/health`](https://thai-crypto-signals.mommyslittlehelper.workers.dev/health) and
[`/v1/tickers/latest`](https://thai-crypto-signals.mommyslittlehelper.workers.dev/v1/tickers/latest).
CI deploys on push to `main`.

## Why it exists

A dependable, well-tested data tap for Thai crypto markets — the kind of boring
infrastructure that good signals are built on. Correctness and provability over
features: integer-exact prices, 100% test coverage, and evidence-based design.

## How it works

```
cron */2  ─▶ collector ──GET──▶ api.bitkub.com/api/v3/market/ticker  (all markets, 1 request)
                │  server-time-anchored bucket · per-entry validation · bigint minor units
                └─▶ D1 (one atomic batch)  +  KV hot-cache  +  Analytics Engine metrics
cron hourly ─▶ rollups (OHLC 1h → 1d, set-based)
cron daily  ─▶ catalog refresh · retention prune
HTTP        ─▶ /health · /v1/symbols · /v1/tickers/latest · /v1/tickers/:symbol · …/rollups
```

- **One Worker, three entrypoints** (`scheduled`, `fetch`, `queue`) behind ports/adapters.
- **Idempotent** snapshots via composite primary keys; a duplicate cron fire writes nothing.
- **Integer money math** — prices stored as bigint minor units (per-symbol `price_scale`),
  volumes kept verbatim. No floating point anywhere on the price path.
- **Respectful** of Bitkub: official public endpoints only, a polite `User-Agent`, and a
  conservative cadence well under the documented rate limits.

## API

| Route | Description |
| --- | --- |
| `GET /health` | Liveness + last-tick freshness, gap and anomaly counters |
| `GET /v1/symbols` | Catalog of tracked markets |
| `GET /v1/tickers/latest` | Latest snapshot per symbol |
| `GET /v1/tickers/:symbol?from=&to=&limit=` | Historical snapshots |
| `GET /v1/tickers/:symbol/rollups?interval=1h\|1d` | OHLC candles |

Read endpoints are public, CORS-enabled, and serve read-only data.

## Development

```bash
pnpm install
pnpm cf-typegen      # generate binding types from wrangler.jsonc
pnpm typecheck       # TypeScript 7 native (tsgo --noEmit)
pnpm check           # Biome lint + format
pnpm test:coverage   # Vitest in the Workers runtime — 100% coverage gate
pnpm deploy          # wrangler deploy (Cloudflare Workers)
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the testing philosophy (real bindings,
no mocks beyond the single recorded HTTP boundary) and engineering ground rules.

## Tech

TypeScript · Cloudflare Workers (Cron, D1, KV, Queues, Analytics Engine) · Vitest
(`@cloudflare/vitest-pool-workers`) · Zod · Biome · Apache-2.0.

## License

[Apache-2.0](./LICENSE).
