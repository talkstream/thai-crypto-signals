import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { D1CollectStore } from '../../src/adapters/storage/collect-store';
import { D1SymbolStore } from '../../src/adapters/storage/symbol-store';
import type { CatalogEntry, RunRecord, TickerSnapshot } from '../../src/domain/types';
import { resetDb } from '../helpers/migrate';

const db = env.DB;

beforeEach(async () => {
  await resetDb(db);
});

function symbol(over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    symbol: 'BTC_THB',
    baseAsset: 'BTC',
    quoteAsset: 'THB',
    priceScale: 2,
    quoteScale: 2,
    marketSegment: 'SPOT',
    status: 'active',
    ...over,
  };
}

function run(over: Partial<RunRecord> = {}): RunRecord {
  return {
    bucketTs: 1000,
    kind: 'collect',
    status: 'ok',
    startedMs: 1001,
    finishedMs: 1002,
    serverTsMs: 1000,
    symbolsSeen: 1,
    rowsInserted: 1,
    rowsSkipped: 0,
    driftCount: 0,
    scaleOverflowCount: 0,
    rowsWritten: 2,
    skewMs: 0,
    httpStatus: 200,
    durationMs: 1,
    errorDetail: null,
    ...over,
  };
}

function snap(symbolId: number, over: Partial<TickerSnapshot> = {}): TickerSnapshot {
  return {
    symbolId,
    bucketTs: 1000,
    observedMs: 1001,
    lastMinor: 200000000n,
    highMinor: 210000000n,
    lowMinor: 190000000n,
    bidMinor: 200000000n,
    askMinor: 200100000n,
    priceScaleUsed: 2,
    baseVolume: '300.4',
    quoteVolume: '6e8',
    pctChangeBp: -94,
    ...over,
  };
}

describe('D1SymbolStore', () => {
  it('upserts and loads with a permanent surrogate id', async () => {
    const store = new D1SymbolStore(db);
    await store.upsertMany([symbol()], 5);
    const first = (await store.loadMap()).get('BTC_THB');
    if (!first) throw new Error('symbol not loaded');
    const { id } = first;

    await store.upsertMany([symbol({ status: 'stopped' })], 6);
    const again = (await store.loadMap()).get('BTC_THB');
    expect(again?.id).toBe(id); // id is permanent across upserts
    expect(again?.status).toBe('stopped');
    expect(again?.priceScale).toBe(2);
  });

  it('upsertMany([]) is a no-op', async () => {
    const store = new D1SymbolStore(db);
    await expect(store.upsertMany([], 1)).resolves.toBeUndefined();
    expect((await store.loadMap()).size).toBe(0);
  });
});

describe('D1CollectStore', () => {
  async function seed(symbols: CatalogEntry[]): Promise<Map<string, number>> {
    const store = new D1SymbolStore(db);
    await store.upsertMany(symbols, 1);
    const map = await store.loadMap();
    return new Map([...map.values()].map((s) => [s.symbol, s.id]));
  }

  it('commits N snapshots + terminal run in one atomic batch (overlap=false)', async () => {
    const ids = await seed([symbol(), symbol({ symbol: 'ETH_THB', baseAsset: 'ETH' })]);
    const btc = ids.get('BTC_THB');
    const eth = ids.get('ETH_THB');
    if (btc === undefined || eth === undefined) throw new Error('seed failed');

    const store = new D1CollectStore(db);
    const res = await store.commitCollect(
      [snap(btc), snap(eth, { lastMinor: 90000000n, bidMinor: null, askMinor: null })],
      run({ symbolsSeen: 2, rowsInserted: 2, rowsWritten: 3 }),
    );
    expect(res.overlap).toBe(false);

    const prior = await store.priorLastBySymbol(1000);
    expect(prior.get(btc)).toBe(200000000n); // exact Number<->bigint round-trip
    expect(prior.get(eth)).toBe(90000000n);

    const row = await db
      .prepare('SELECT bid_minor, ask_minor FROM ticker_snapshots WHERE symbol_id = ?')
      .bind(eth)
      .first<{ bid_minor: number | null; ask_minor: number | null }>();
    expect(row?.bid_minor).toBeNull(); // one-sided book persisted as NULL
    expect(row?.ask_minor).toBeNull();
  });

  it('detects a duplicate fire as overlap and writes nothing new', async () => {
    const ids = await seed([symbol()]);
    const btc = ids.get('BTC_THB');
    if (btc === undefined) throw new Error('seed failed');
    const store = new D1CollectStore(db);

    await store.commitCollect([snap(btc)], run());
    const res2 = await store.commitCollect(
      [snap(btc, { lastMinor: 999n })],
      run({ status: 'partial' }),
    );
    expect(res2.overlap).toBe(true);

    const prior = await store.priorLastBySymbol(1000);
    expect(prior.get(btc)).toBe(200000000n); // original kept (INSERT OR IGNORE)
    const runRow = await db
      .prepare('SELECT status FROM collection_runs WHERE bucket_ts = 1000 AND kind = ?')
      .bind('collect')
      .first<{ status: string }>();
    expect(runRow?.status).toBe('ok'); // original run row kept, not clobbered
  });

  it('writes the run row even with no snapshots', async () => {
    const store = new D1CollectStore(db);
    const res = await store.commitCollect(
      [],
      run({ status: 'drift', symbolsSeen: 0, rowsInserted: 0 }),
    );
    expect(res.overlap).toBe(false);
    const row = await db
      .prepare('SELECT status FROM collection_runs WHERE bucket_ts = 1000 AND kind = ?')
      .bind('collect')
      .first<{ status: string }>();
    expect(row?.status).toBe('drift');
  });

  it('failRun writes a terminal run row', async () => {
    const store = new D1CollectStore(db);
    await store.failRun(run({ status: 'fetch_failed', errorDetail: 'boom' }));
    const row = await db
      .prepare(
        'SELECT status, error_detail FROM collection_runs WHERE bucket_ts = 1000 AND kind = ?',
      )
      .bind('collect')
      .first<{ status: string; error_detail: string }>();
    expect(row?.status).toBe('fetch_failed');
    expect(row?.error_detail).toBe('boom');
  });

  it('rethrows a non-constraint store error', async () => {
    const ids = await seed([symbol()]);
    const btc = ids.get('BTC_THB');
    if (btc === undefined) throw new Error('seed failed');
    await db.prepare('DROP TABLE ticker_snapshots').run(); // force a non-UNIQUE failure
    const store = new D1CollectStore(db);
    await expect(store.commitCollect([snap(btc)], run())).rejects.toThrow();
  });
});
