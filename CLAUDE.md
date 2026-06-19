# thai-crypto-signals (bitkub) — Cloudflare Workers, **pnpm**

## ⚠️ TypeScript 7.0 RC — read before touching the toolchain

This project type-checks with **TypeScript 7.0 RC** (`typescript@7.0.1-rc`, the native Go
compiler). Migrated off the `@typescript/native-preview` nightly on 2026-06-19.

- Package manager is **pnpm** (`pnpm@10.33.2`). Use `pnpm` for everything (`pnpm install`,
  `pnpm add -D`, `pnpm typecheck`). CI runs `pnpm install --frozen-lockfile` — commit `pnpm-lock.yaml`.
- The type-check binary is **`tsc`** (native), NOT `tsgo`. `pnpm typecheck` = `tsc --noEmit`.
- **Do NOT reinstall `@typescript/native-preview`** and do NOT run `tsgo` — both are gone on purpose.
- `typescript` is pinned exact to **`7.0.1-rc`** (a pre-release). Bump deliberately (Renovate pins it);
  when TS 7.0 stable ships, move to `typescript@7`.
- **Editor/LSP:** the global `typescript@6.x` powers `typescript-language-server` (the RC ships no
  `tsserver`); for TS7-accurate IDE diagnostics use the VS Code "TypeScript Native Preview" extension.
  Do not replace the global typescript with the RC.
- Linter is **Biome** (no ESLint) — no `@typescript-eslint` peer-dep concern.

Owner mandate: TS7 RC is the source of truth for all TS projects. Fleet runbook:
`~/.claude/runbooks/ts7-rc-migration.md`.
