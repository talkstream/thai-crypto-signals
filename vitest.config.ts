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
      // 100% of ALL live production code — the entire signals pipeline (producer, consumer, notifiers,
      // wiring, indicators) is now live and covered; nothing under src/signals is carved out. Only
      // non-product files remain excluded: recorded cassettes, the spike dir, the generated
      // worker-configuration.d.ts, and the tests themselves. Guarded, never widened silently.
      exclude: [
        'src/adapters/bitkub/cassettes/**',
        'src/spike/**',
        'worker-configuration.d.ts',
        'test/**',
      ],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
