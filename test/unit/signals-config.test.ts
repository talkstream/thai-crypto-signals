import { describe, expect, it } from 'vitest';
import type { SignalConfigStore } from '../../src/domain/ports';
import { resolveSignalConfig, type SignalConfig } from '../../src/signals/config';

// Plain port-double (DI, not vi.mock): a store that returns a fixed load() result.
const storeReturning = (cfg: SignalConfig | null): SignalConfigStore => ({
  load: async () => cfg,
});

const DEFAULTS: SignalConfig = { watchlist: ['TON_THB'], thresholdBp: 300 };

describe('resolveSignalConfig', () => {
  it('returns the stored config when the row is present', async () => {
    const stored: SignalConfig = { watchlist: ['BTC_THB', 'ETH_THB'], thresholdBp: 1000 };
    expect(await resolveSignalConfig(storeReturning(stored), DEFAULTS)).toEqual(stored);
  });

  it('falls back to the env-seeded defaults when the store is empty', async () => {
    expect(await resolveSignalConfig(storeReturning(null), DEFAULTS)).toEqual(DEFAULTS);
  });
});
