# Contributing

Thanks for your interest! This is a small, focused project — contributions that keep it
simple, well-tested, and honest are very welcome.

## Development setup

```bash
pnpm install
pnpm cf-typegen        # generate worker-configuration.d.ts from wrangler.jsonc
pnpm typecheck         # tsgo --noEmit (TypeScript 7 native), tsc 6.x as fallback
pnpm check             # Biome lint + format
pnpm test:coverage     # Vitest (Cloudflare Workers pool) — 100% coverage gate
```

## Ground rules

- **Tests, no mocks of our own code.** Storage (D1/KV/Queue) is exercised against the
  real Miniflare runtime; non-deterministic boundaries use injected ports/fakes. The
  **only** stubbed boundary is the outbound Bitkub HTTP call (replayed from recorded
  real payloads in `src/adapters/bitkub/cassettes/`). Coverage must stay at 100%.
- **Prices are integers.** Money math uses bigint minor units end-to-end — never floats.
- **No wall-clock / SQL `now()`** outside the injected `Clock` adapter (CI-guarded).
- **Conventional Commits** (`feat:`, `fix:`, `chore:` …); `commitlint` runs on commit.
- **Respect Bitkub.** Only official public endpoints, a polite `User-Agent`, and a
  conservative polling cadence. No abuse.

## Pull requests

CI must pass: typecheck, Biome, 100%-coverage tests, build, and the repo guards.
Keep PRs small and scoped.
