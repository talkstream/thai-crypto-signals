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
      // EXACTLY these four exclusions (CI-guarded in Phase 10).
      exclude: [
        'src/adapters/bitkub/cassettes/**',
        'src/spike/**',
        'worker-configuration.d.ts',
        'test/**',
      ],
    },
  },
});
