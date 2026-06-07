import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { D1SignalConfigStore } from '../../src/adapters/storage/config-store';
import { resetDb } from '../helpers/migrate';

// No mock: the store wraps the REAL bound D1 (Miniflare) provided by the Workers test pool.
const db = env.DB;

beforeEach(async () => {
  await resetDb(db);
});

describe('D1SignalConfigStore', () => {
  it('loads the seeded config (TON_THB / 300)', async () => {
    expect(await new D1SignalConfigStore(db).load()).toEqual({
      watchlist: ['TON_THB'],
      thresholdBp: 300,
    });
  });

  it('upserts the single row, then reloads it', async () => {
    const store = new D1SignalConfigStore(db);
    await store.save({ watchlist: ['BTC_THB', 'ETH_THB'], thresholdBp: 1000 }, 12_345);
    expect(await store.load()).toEqual({ watchlist: ['BTC_THB', 'ETH_THB'], thresholdBp: 1000 });
  });

  it('round-trips an empty watchlist as an empty list (= all symbols)', async () => {
    const store = new D1SignalConfigStore(db);
    await store.save({ watchlist: [], thresholdBp: 500 }, 1);
    expect(await store.load()).toEqual({ watchlist: [], thresholdBp: 500 });
  });

  it('returns null when the config row is absent', async () => {
    await db.prepare('DELETE FROM signal_config WHERE id = 1').run();
    expect(await new D1SignalConfigStore(db).load()).toBeNull();
  });
});
