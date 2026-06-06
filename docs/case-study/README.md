# Case study — building Thai Crypto Signals with an AI agent

> A SotA, evidence-driven Cloudflare Workers crypto-rate collector, built end-to-end in a
> single autonomous session by Claude Code under director-style supervision. This document is
> the engineering narrative; the raw, console-verbatim session transcript is the primary
> artifact (kept next to the Claude Code log history, outside this repo).

## What was built

A single Cloudflare Worker that, every two minutes, pulls **all ~441 Bitkub THB markets in one
request**, validates each entry, and writes an idempotent, integer-exact snapshot to D1 — plus a
read API, hourly/daily OHLC rollups, daily retention, and a **dark (zero-delivery) scaffold** for
phase-2 signals/notifications. Live: `https://thai-crypto-signals.mommyslittlehelper.workers.dev`.

- TypeScript 7 (`tsgo`) typecheck · Biome v2 · Vitest (Workers pool) · D1 / KV / Queues / Analytics Engine.
- **100% test coverage** (statements/branches/functions/lines) with **no mocks** beyond the single
  recorded Bitkub HTTP boundary; storage exercised against the real Miniflare runtime.

## How it was built — two agent panels

1. **Research panel (7 agents).** Verified, with sources, the current state of every layer:
   Bitkub's official API + ToS, the 2026 Cloudflare platform, TypeScript 7 readiness,
   `@cloudflare/vitest-pool-workers`, notification architecture, indicator formulas, repo/CI norms.
2. **Design panel (16 agents, 3 adversarial rounds).** Three biased architects → synthesis →
   skeptical reviewers (reliability / cost / testability) looping until clean. It killed several
   plausible-but-wrong ideas with verified reasoning before a line of code was written.

Both the plan and each step then went through a **review-until-clean** loop.

## Evidence correcting the plan (the interesting part)

Reproducer-first discipline turned up things no amount of memory would have:

- **D1 rejects `bigint` binds** (`D1_TYPE_ERROR`) and returns INTEGER columns as JS `number`,
  lossy above 2^53. The plan's "int64-exact" assumption was wrong → prices bind via `Number()`
  and the overflow guard fires at `MAX_SAFE_MINOR` (2^53−1), unreachable for real Bitkub prices.
- **Bitkub's ticker is a bare JSON array** with `highest_bid`/`lowest_ask` (17% one-sided → NULL)
  and optional `*_self` fields — not the `{error,result}` envelope the docs implied.
- **`@cloudflare/vitest-pool-workers` v0.16 dropped the `/config` subpath** (vitest 4): config is
  now the `cloudflareTest` plugin. And `undici MockAgent`/`fetchMock` isn't available in the pool
  → the HTTP boundary is stubbed via `vi.spyOn(globalThis.fetch)` with recorded cassettes.
- **SQLite needs an explicit `WHERE true`** before `ON CONFLICT` in `INSERT…SELECT` upserts.
- **Cron cadence must be a 60-divisor**, or `*/N` firing and the continuous-epoch bucket collide
  at the hour boundary (verified with Node).

## Correctness choices

- **Integer money math** end-to-end (bigint minor units; volumes kept verbatim); one canonical
  formatter so a KV cache hit and a D1 rebuild are byte-identical.
- **Idempotent collect**: one atomic D1 batch (N snapshots + a terminal run row); a duplicate cron
  fire writes nothing and is surfaced as an Analytics Engine event.
- **Per-entry tolerance**: a malformed/over-scale/unlisted entry is skipped and counted, never
  discarding the tick. (Production confirmed this live: `drift=3` of 441, 438 stored.)
- **Determinism**: no wall-clock or randomness outside the injected `Clock`/`Rng` adapter
  (CI-guarded); all time in tests is injected.

## Production verification

Deployed on the paid plan; the first `*/2` tick bootstrapped the catalog (454 symbols) and
collected in one run. `/health` → `ok:true`; `/v1/tickers/latest` returned a correctly formatted
`BTC_THB` (`last: 1991284.58`, bid/ask, `pctChangeBp`). The full pipeline — cron → Bitkub → D1 →
read API — was verified against the live service, not just tests.

## Artifacts

- The plan: `~/.claude/plans/twinkly-gliding-clover.md` (research synthesis + final design).
- Conventional-commit history: one reviewed, green commit per phase.
- Raw session transcript: `session-raw-console.md` (regenerate via `scripts/export-session-raw.mjs`).

## Disclaimer

Not financial advice. Technical indicators have mixed empirical support; nothing here is a
buy/sell recommendation.
