import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { D1SignalConfigStore } from '../../src/adapters/storage/config-store';
import { resetDb } from '../helpers/migrate';

// No mock: the store wraps the REAL bound D1 (Miniflare) provided by the Workers test pool.
const db = env.DB;

beforeEach(async () => {
  await resetDb(db);
});

describe('D1SignalConfigStore — producer read path (load)', () => {
  it('returns the seeded config (TON_THB / 300)', async () => {
    expect(await new D1SignalConfigStore(db).load()).toEqual({
      watchlist: ['TON_THB'],
      thresholdBp: 300,
    });
  });

  it('returns null when the config row is absent', async () => {
    await db.prepare('DELETE FROM signal_config WHERE id = 1').run();
    expect(await new D1SignalConfigStore(db).load()).toBeNull();
  });
});

describe('D1SignalConfigStore — bot read/write path (loadState / saveState)', () => {
  it('loadState returns the seeded row with pending = null', async () => {
    expect(await new D1SignalConfigStore(db).loadState()).toEqual({
      watchlist: ['TON_THB'],
      thresholdBp: 300,
      pending: null,
    });
  });

  it('saveState then loadState round-trips config + pending atomically; load() ignores pending', async () => {
    const store = new D1SignalConfigStore(db);
    await store.saveState(
      { watchlist: ['BTC_THB', 'ETH_THB'], thresholdBp: 1000, pending: 'add' },
      12_345,
    );
    expect(await store.loadState()).toEqual({
      watchlist: ['BTC_THB', 'ETH_THB'],
      thresholdBp: 1000,
      pending: 'add',
    });
    expect(await store.load()).toEqual({ watchlist: ['BTC_THB', 'ETH_THB'], thresholdBp: 1000 });
  });

  it('round-trips an empty watchlist and a threshold pending, then clears pending', async () => {
    const store = new D1SignalConfigStore(db);
    await store.saveState({ watchlist: [], thresholdBp: 500, pending: 'threshold' }, 1);
    expect((await store.loadState())?.pending).toBe('threshold');
    await store.saveState({ watchlist: [], thresholdBp: 500, pending: null }, 2);
    expect(await store.loadState()).toEqual({ watchlist: [], thresholdBp: 500, pending: null });
  });

  it('saveState CREATES the row when absent (no NOT NULL failure — the C1 fix)', async () => {
    await db.prepare('DELETE FROM signal_config WHERE id = 1').run();
    const store = new D1SignalConfigStore(db);
    await store.saveState({ watchlist: ['TON_THB'], thresholdBp: 300, pending: 'add' }, 7);
    expect(await store.loadState()).toEqual({
      watchlist: ['TON_THB'],
      thresholdBp: 300,
      pending: 'add',
    });
  });

  it('loadState normalizes an unknown pending value to null', async () => {
    await db.prepare("UPDATE signal_config SET pending = 'garbage' WHERE id = 1").run();
    expect((await new D1SignalConfigStore(db).loadState())?.pending).toBeNull();
  });

  it('loadState returns null when the row is absent', async () => {
    await db.prepare('DELETE FROM signal_config WHERE id = 1').run();
    expect(await new D1SignalConfigStore(db).loadState()).toBeNull();
  });
});
