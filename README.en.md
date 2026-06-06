<!-- Languages: [ไทย](./README.md) · **English** · [Русский](./README.ru.md) -->

# Thai Crypto Signals — a hands-on guide to collecting exchange rates on Cloudflare Workers

> **Repository:** https://github.com/talkstream/thai-crypto-signals ·
> **Live demo:** https://thai-crypto-signals.mommyslittlehelper.workers.dev

A small, production-grade service that pulls cryptocurrency rates from the **Bitkub** public API
every two minutes, stores them exactly, and serves them through a tiny read API — all on
**Cloudflare Workers**. It doubles as a free, worked example of how to integrate a public API on
serverless infrastructure with the correctness a real service needs, shared freely for students and
self-taught developers.

> **For education only.** This is not financial advice and not a claim of regulatory compliance.
> Trading digital assets carries high risk. Full details in [Risk notice](#risk-notice) below.

---

## Who this is for

A student or junior developer who can read basic **JavaScript/TypeScript** and use a terminal. No
Cloudflare or blockchain background is required; everything else is explained along the way.

**Prerequisites**
- Node.js **22+**, **pnpm**, and **git** installed. (Check with `node -v`, `pnpm -v`, `git -v`.)
- For the optional deploy track: a free Cloudflare account and a little comfort editing a JSON
  config file.

**Time:** about 30 minutes to read and run locally once your tools are installed; longer the first
time if you are still setting up Node and pnpm. The deploy track adds roughly half an hour.

## What you will learn

1. How a **public exchange API** is shaped, and how to read rates within its rules.
2. How **serverless cron** jobs run code on a schedule with no server to manage.
3. Why money belongs in **integers**, never floats — and how to do that.
4. How to make a repeated job **idempotent** (safe to run twice) using the database.
5. How to test code against **real infrastructure** instead of fakes.

### Mini-glossary
- **API** — a defined way for one program to request data from another over the network.
- **Endpoint** — a specific API URL that returns one kind of data (e.g. all current prices).
- **Serverless / Cloudflare Workers** — you upload a function; the platform runs it on demand and on
  a schedule. There is no machine for you to maintain.
- **cron** — a time schedule for running a job (e.g. "every 2 minutes").
- **D1** — Cloudflare's built-in SQL database (SQLite).
- **KV** — Cloudflare's fast key-value cache.
- **bigint** — a JavaScript integer type with no size limit, unlike the ordinary `number`.
- **minor units** — the smallest whole unit of a value (think satang, or satoshis), stored as an
  integer so no fraction is ever lost.
- **idempotent** — an operation you can run many times and get the same result as running it once;
  safe to repeat.
- **time bucket** — a timestamp rounded down to a fixed window (here, the 2-minute slot), used to
  group and de-duplicate each tick.
- **OHLC** — Open/High/Low/Close, the four numbers that summarise price over a window (a candle).

---

## Background: the pieces

**The exchange API.** Bitkub publishes a free, public, read-only API. Three endpoints matter here,
and none needs a key:
- `GET /api/v3/market/symbols` — the catalogue of tradable markets (e.g. `BTC_THB`) and each
  market's **price scale** (how many decimal places its price uses).
- `GET /api/v3/market/ticker` — the current snapshot for **every** market in **one** request.
- `GET /api/v3/servertime` — the exchange's clock, in milliseconds.

**Reading respectfully.** A public API is a shared resource. This project polls on a conservative
schedule (once every 2 minutes), sends a clear identifying `User-Agent`, fetches all markets in a
single request rather than hammering one symbol at a time, and touches only public endpoints.
Always check an API's Terms of Service before you write automation on top of it.

**Serverless.** Rather than renting a machine that runs all day, we upload one **Worker**. Cloudflare
runs it on three schedules (collect, roll up, maintain) and whenever an HTTP request arrives.

## How it works

```
cron */2 (every 2 min)  ─▶  collector  ──GET──▶  Bitkub /market/ticker   (all markets, 1 request)
                              │  pin a time "bucket" (rounded timestamp) to Bitkub's clock
                              │  validate each entry · convert prices to integer "minor units"
                              └─▶ D1 (one atomic write) + KV hot-cache + metrics
cron hourly             ─▶  roll snapshots up into 1-hour, then 1-day OHLC candles
cron daily             ─▶  refresh the market catalogue · delete data past its retention window
HTTP request           ─▶  read API: /health · /v1/symbols · /v1/tickers/latest · …/:symbol · …/rollups
```

It is one Worker with three scheduled jobs and an HTTP handler, split into small parts that can each
be read and tested on their own.

### The read API

| Route | What it returns |
| --- | --- |
| `GET /health` | freshness of the latest data, symbol count, and anomaly counters |
| `GET /v1/symbols` | the catalogue of tracked markets |
| `GET /v1/tickers/latest` | the most recent snapshot for every market |
| `GET /v1/tickers/:symbol?from=&to=&limit=` | historical snapshots for one market |
| `GET /v1/tickers/:symbol/rollups?interval=1h\|1d` | OHLC candles |

---

## Code tour — five lessons, mapped to the source

The most instructive parts of the codebase. Each is a lesson you can carry to other projects; each
points to where in the file to look.

1. **Integer money math** — [`src/domain/price.ts`](./src/domain/price.ts). Prices arrive as decimal
   strings (`"2017050.88"`). Floating-point loses precision on large values, so each price becomes a
   **bigint in minor units** and stays an integer everywhere. *Look for:* `parseDecimalToMinor`
   (string → bigint) and `formatMinorToDecimal` (back to a string); read the file header first.
2. **Knowing your database's limits** — [`src/adapters/storage/d1.ts`](./src/adapters/storage/d1.ts).
   D1 will not bind a JavaScript `bigint`, and it hands integer columns back as a JS `number`, which
   is exact only up to 2⁵³−1. So values are checked against that bound when parsed. *Look for:* the
   short header comment — it states the limit and why there is no defensive branch. *Lesson: measure
   how your storage really behaves before you design around it.*
3. **Idempotency** — [`src/adapters/storage/collect-store.ts`](./src/adapters/storage/collect-store.ts).
   A schedule can fire twice for one time-bucket. Snapshots are written with `INSERT OR IGNORE`, and
   the run's ledger row carries a strict unique key on the time-bucket — so a second run for the same
   bucket trips that constraint and the whole batch rolls back. A repeat run leaves the data
   untouched. *Look for:* `commitCollect` and the `isUniqueConstraintError` check.
4. **Time math that does not drift** — [`src/config/cadence.ts`](./src/config/cadence.ts). The
   collect schedule must divide 60 evenly (1, 2, 3, 4, 5, …). A value like 7 or 13 would let the
   cron firing and the bucket calculation disagree at the top of each hour. *Look for:* `cronExprFor`
   (throws on a bad cadence at start-up) and `bucketTsFor` (floors a timestamp to its bucket).
5. **Tolerating bad input** — [`src/collector/collect.ts`](./src/collector/collect.ts) +
   [`src/adapters/bitkub/schemas.ts`](./src/adapters/bitkub/schemas.ts). The ticker is validated one
   entry at a time: a malformed or unknown market is counted and skipped while the other ~440 good
   entries go through. *Look for:* the per-entry loop that `continue`s in `collect.ts`, and
   `safeParseTickerEntry`, which returns `null` for a bad entry.

---

## Run it yourself

Two tracks. The **local track** needs no Cloudflare account. The **deploy track** is optional.

### Local track (no account needed)

```bash
git clone https://github.com/talkstream/thai-crypto-signals
cd thai-crypto-signals
pnpm install
pnpm cf-typegen                                                      # generate binding types
pnpm exec wrangler d1 migrations apply thai-crypto-signals --local   # create local tables
pnpm test:coverage                                                   # run the test suite
```

The test suite spins up a **real local D1 database, KV, and queue** — nothing about the storage is
faked. The only stubbed boundary is the single outbound call to Bitkub. That is what "testing
against real infrastructure" means, and why the suite catches real bugs.

Now start the Worker locally and trigger one collect tick by hand:

```bash
pnpm exec wrangler dev --test-scheduled                     # serves http://localhost:8787
# in a second terminal — fire the */2 collect job once:
curl "http://localhost:8787/__scheduled?cron=*/2+*+*+*+*"
# then read the data it just collected from the real Bitkub API:
curl http://localhost:8787/health
curl http://localhost:8787/v1/tickers/latest
```

**✓ Checkpoint.** `/health` should look roughly like this:

```json
{
  "ok": true,
  "nowMs": 1780772708158,
  "lastCollectBucketTs": 1780772640000,
  "lastCollectStatus": "partial",
  "lastObservedMs": 1780772647007,
  "symbolCount": 454,
  "recentDrift": 3,
  "recentScaleOverflow": 0
}
```

`ok: true` with `symbolCount` above 0 means it worked. `symbolCount: 0` almost always means the
`/__scheduled` step was skipped — the database stays empty until a collect tick runs. (`partial`
and a small `recentDrift` are normal: a few markets are one-sided or unlisted and get skipped.)

*Note:* local dev makes a **real** request to Bitkub from your machine, so trigger it sparingly.

**Troubleshooting**
- `command not found: wrangler` → run it through `pnpm exec wrangler …`; Wrangler is a project
  dependency, not a global program.
- migrations error → the third word in the command must be exactly `thai-crypto-signals`, matching
  the name in `wrangler.jsonc`.
- empty `/health` → fire `/__scheduled` first (see above), then read again.

### Deploy track (your own Cloudflare account, optional)

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create my-crypto-db
pnpm exec wrangler kv namespace create CACHE
pnpm exec wrangler queues create my-signals          # plus a my-signals-dlq dead-letter queue
# edit wrangler.jsonc: put your new database_id / kv id / queue names in place of the originals
pnpm exec wrangler d1 migrations apply my-crypto-db --remote
pnpm deploy
```

**✓ Checkpoint.** Open `https://<your-worker>.workers.dev/health` — you should get the same shape as
the local checkpoint. Give the `*/2` cron one tick (≈2 minutes) to populate data. A Worker error page
usually means migrations were not applied with `--remote`, or a binding id in `wrangler.jsonc` is
still the original rather than yours.

**Cost.** Cron triggers, D1, and KV fit comfortably in Cloudflare's **free** tier for this workload.
**Queues require the Workers Paid plan** — and queues are only used by the disabled signals scaffold,
so to stay on the free tier, delete the `queues` block from `wrangler.jsonc` before deploying.

**Cleanup (so you do not leave resources running)**

```bash
pnpm exec wrangler delete                             # the Worker
pnpm exec wrangler d1 delete my-crypto-db
pnpm exec wrangler kv namespace delete --namespace-id <id>
pnpm exec wrangler queues delete my-signals
```

---

## <a id="risk-notice"></a>Risk notice — please read

This material is for **general education only**. It is **not** financial or investment advice, and
**not** a claim of compliance with any regulation, including the rules of the Thai SEC
(https://www.sec.or.th). Nothing here recommends buying, selling, or holding any digital asset.
Trading digital assets such as cryptocurrency carries **high risk, up to the total loss of your
money**. Study the official sources and consult a licensed professional before any financial
decision. The authors and any related institutions do not endorse trading and accept no liability
for your use of this code.

---

## Exercises

Make the ideas your own. Each lists a difficulty and a hint.

1. **(Easy)** Add a `?quote=THB` filter to `GET /v1/symbols` so it returns only markets quoted in a
   given asset. *Hint:* filter the catalogue in `src/api/router.ts` before it is serialized.
2. **(Medium)** Add a 15-minute rollup interval alongside 1h/1d. *Hint:* the rollup is set-based SQL
   in `src/collector/rollup-job.ts`; remember the 60-divisor rule when you pick the window.
3. **(Medium)** Add a test for a new failure mode — say, the ticker returns HTTP 500. *Hint:* the
   only stubbed boundary is `globalThis.fetch`; see `test/integration/collect.test.ts` for the
   pattern.
4. **(Advanced)** Light up the disabled **signals** scaffold and send one Telegram message when a
   price moves more than X%. *Hint:* `src/signals/` is wired but delivery is off via the
   `SIGNALS_ENABLED` flag (a `var` in `wrangler.jsonc`; secrets go in with
   `pnpm exec wrangler secret put …`). Keep it respectful and rate-limited.

---

## Check yourself

If you can answer these without re-reading, the lessons landed:

- Why is a floating-point number a poor choice for storing a price?
- What makes the collect job safe to run twice for the same minute?
- Why must the collect cadence divide 60 evenly?
- What happens to one malformed entry in a ticker of ~440 markets?
- What does this project actually fake in its tests, and what does it keep real?

## Summary & next steps

This is a complete, tested, deployable serverless service, small enough to read in an afternoon. Run
it locally, try one exercise, then open the files from the code tour — each is short and written to
be read.

## References & credits

- Bitkub official API documentation — https://github.com/bitkub/bitkub-official-api-docs
- Cloudflare Workers documentation — https://developers.cloudflare.com/workers/
- Thailand SEC (digital assets) — https://www.sec.or.th
- Built with TypeScript, Cloudflare Workers (Cron, D1, KV, Queues, Analytics Engine), Vitest, Zod,
  and Biome. Thanks to the open-source projects and documentation that made it possible.

## License

[Apache-2.0](./LICENSE). You are welcome to study, run, fork, and teach from this repository.
