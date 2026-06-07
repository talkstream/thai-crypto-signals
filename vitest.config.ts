import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// vitest 4 + @cloudflare/vitest-pool-workers >=0.16: the pool is wired via the
// `cloudflareTest` plugin (the legacy `defineWorkersConfig` / `/config` subpath is gone).
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.ts'],
      // EXACTLY these exclusions (CI-guarded by scripts/guard-coverage-exclude.mjs). Coverage is
      // 100% of the LIVE production code. The signals subsystem is a DORMANT, frozen phase-2
      // scaffold (no producer is wired, nothing is ever delivered); we deliberately do NOT exercise
      // dead code with fakes — it is documented in its file headers and guaranteed by the type
      // system (the SignalDispatcher/SignalJob ports + a compile-time `satisfies` check in
      // src/signals/contract.ts). It is carved out here explicitly and guarded, never silently.
      exclude: [
        'src/adapters/bitkub/cassettes/**',
        'src/spike/**',
        'worker-configuration.d.ts',
        'test/**',
        'src/signals/**',
        'src/adapters/signals/**',
      ],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
