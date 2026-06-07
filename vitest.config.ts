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
      // 100% of the LIVE production code. Only the genuinely DEAD producer-side signals scaffold is
      // carved out — each of these files has ZERO runtime callers (verified) and is a frozen phase-2
      // stub, documented in its header and type-checked via src/signals/contract.ts. The LIVE
      // consumer (src/signals/consumer.ts, wired into the queue() handler) is NOT excluded: it is
      // covered by test/unit/signals-consumer.test.ts. Carved out explicitly and guarded, never
      // silently.
      exclude: [
        'src/adapters/bitkub/cassettes/**',
        'src/spike/**',
        'worker-configuration.d.ts',
        'test/**',
        'src/signals/indicators.ts',
      ],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
