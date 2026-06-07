import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { BitkubAdapter } from '../../src/adapters/bitkub/client';
import { D1SymbolStore } from '../../src/adapters/storage/symbol-store';
import { maintenance } from '../../src/collector/maintenance';
import { gmt7DayStart, hourStart, rollup } from '../../src/collector/rollup-job';
import type { Fetcher } from '../../src/domain/ports';
import { FakeClock, FakeRng, InMemoryObservabilitySink, recordingFetcher } from '../helpers/fakes';
import { resetDb } from '../helpers/migrate';

const db = env.DB;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const T = 1_700_000_000_000;

beforeEach(async () => {
  await resetDb(db);
});

async function seedBtc(): Promise<number> {
  const store = new D1SymbolStore(db);
  await store.upsertMany(
    [
      {
        symbol: 'BTC_THB',
        baseAsset: 'BTC',
        quoteAsset: 'THB',
        priceScale: 2,
        quoteScale: 2,
        marketSegment: 'SPOT',
        status: 'active',
      },
    ],
    1,
  );
  const btc = (await store.loadMap()).get('BTC_THB');
  if (!btc) throw new Error('seed failed');
  return btc.id;
}

async function insertSnap(symbolId: number, bucketTs: number, last: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ticker_snapshots
        (symbol_id, bucket_ts, observed_ms, last_minor, high_minor, low_minor, price_scale_used,
         base_volume, quote_volume, pct_change_bp, ingested_ms)
       VALUES (?, ?, ?, ?, ?, ?, 2, '1', '1', 0, ?)`,
    )
    .bind(symbolId, bucketTs, bucketTs, last, last, last, bucketTs)
    .run();
}

describe('rollup', () => {
  it('builds hourly OHLC set-based and a derived daily candle', async () => {
    const btc = await seedBtc();
    const h = hourStart(T) - HOUR; // a fully-past hour
    await insertSnap(btc, h, 10000); // open
    await insertSnap(btc, h + 120_000, 30000); // high
    await insertSnap(btc, h + 240_000, 20000); // close
    await rollup({
      db,
      obs: new InMemoryObservabilitySink(),
      clock: new FakeClock(T),
      maxWindows: 48,
    });

    const hourly = await db
      .prepare('SELECT * FROM rollups_1h WHERE symbol_id = ? AND hour_ts = ?')
      .bind(btc, h)
      .first<{
        open_minor: number;
        high_minor: number;
        low_minor: number;
        close_minor: number;
        sample_count: number;
        finalized: number;
      }>();
    expect(hourly).toMatchObject({
      open_minor: 10000,
      high_minor: 30000,
      low_minor: 10000,
      close_minor: 20000,
      sample_count: 3,
      finalized: 1,
    });

    const daily = await db
      .prepare('SELECT * FROM rollups_1d WHERE symbol_id = ? AND day_ts = ?')
      .bind(btc, gmt7DayStart(h))
      .first<{ open_minor: number; close_minor: number; sample_count: number }>();
    expect(daily).toMatchObject({ open_minor: 10000, close_minor: 20000, sample_count: 3 });
  });

  it('is idempotent and produces no rows for empty windows', async () => {
    const btc = await seedBtc();
    const h = hourStart(T) - HOUR;
    await insertSnap(btc, h, 10000);
    const deps = {
      db,
      obs: new InMemoryObservabilitySink(),
      clock: new FakeClock(T),
      maxWindows: 48,
    };
    await rollup(deps);
    await rollup(deps); // re-run: ON CONFLICT DO UPDATE, same result
    const count = await db.prepare('SELECT COUNT(*) AS n FROM rollups_1h').first<{ n: number }>();
    expect(count?.n).toBe(1); // only the one window with data
  });

  it('aggregates only the latest scale when a window mixes scales', async () => {
    const btc = await seedBtc();
    const h = hourStart(T) - HOUR;
    const ins = `INSERT INTO ticker_snapshots
      (symbol_id, bucket_ts, observed_ms, last_minor, high_minor, low_minor, price_scale_used,
       base_volume, quote_volume, pct_change_bp, ingested_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, '1', '1', 0, ?)`;
    // older row at scale 2, newer row at scale 4 (a mid-window scale change)
    await db.prepare(ins).bind(btc, h, h, 10000, 10000, 10000, 2, h).run();
    await db
      .prepare(ins)
      .bind(btc, h + 120_000, h + 120_000, 1000000, 1000000, 1000000, 4, h + 120_000)
      .run();
    await rollup({
      db,
      obs: new InMemoryObservabilitySink(),
      clock: new FakeClock(T),
      maxWindows: 48,
    });
    const hourly = await db
      .prepare(
        'SELECT open_minor, close_minor, price_scale_used, sample_count FROM rollups_1h WHERE symbol_id = ? AND hour_ts = ?',
      )
      .bind(btc, h)
      .first<{
        open_minor: number;
        close_minor: number;
        price_scale_used: number;
        sample_count: number;
      }>();
    expect(hourly).toMatchObject({
      open_minor: 1000000,
      close_minor: 1000000,
      price_scale_used: 4,
      sample_count: 1, // the scale-2 row is excluded, not mixed in
    });
  });
});

describe('maintenance', () => {
  function adapter(fetcher: Fetcher): BitkubAdapter {
    return new BitkubAdapter({
      baseUrl: 'https://api.bitkub.com',
      timeoutMs: 8000,
      clock: new FakeClock(0),
      rng: new FakeRng(0.5),
      fetcher,
    });
  }

  it('refreshes the catalog and prunes old raw + collect ledger', async () => {
    const btc = await seedBtc();
    await insertSnap(btc, T - 10 * DAY, 100); // older than 7d retention
    await insertSnap(btc, T - HOUR, 200); // recent
    await db
      .prepare(
        `INSERT INTO collection_runs (bucket_ts, kind, status, started_ms, finished_ms, server_ts_ms,
          symbols_seen, rows_inserted, rows_skipped, drift_count, scale_overflow_count, rows_written,
          skew_ms, http_status, duration_ms, error_detail)
         VALUES (?, 'collect', 'ok', ?, ?, NULL, 0, 0, 0, 0, 0, 0, NULL, NULL, 0, NULL)`,
      )
      .bind(T - 40 * DAY, T - 40 * DAY, T - 40 * DAY)
      .run();

    const f = recordingFetcher(() =>
      Response.json({
        error: 0,
        result: [
          {
            symbol: 'ETH_THB',
            base_asset: 'ETH',
            quote_asset: 'THB',
            base_asset_scale: 8,
            price_scale: 2,
            quote_asset_scale: 2,
            market_segment: 'SPOT',
            status: 'active',
          },
        ],
      }),
    );

    const store = new D1SymbolStore(db);
    await maintenance({
      db,
      marketData: adapter(f.fetcher),
      symbols: store,
      obs: new InMemoryObservabilitySink(),
      clock: new FakeClock(T),
      retentionDays: 7,
      runsRetentionDays: 30,
      rollups1hRetentionDays: 90,
    });

    expect((await store.loadMap()).has('ETH_THB')).toBe(true); // catalog refreshed
    const snaps = await db
      .prepare('SELECT COUNT(*) AS n FROM ticker_snapshots')
      .first<{ n: number }>();
    expect(snaps?.n).toBe(1); // old pruned, recent kept
    const oldRuns = await db
      .prepare("SELECT COUNT(*) AS n FROM collection_runs WHERE kind = 'collect'")
      .first<{ n: number }>();
    expect(oldRuns?.n).toBe(0); // old collect run pruned
    const cat = await db
      .prepare("SELECT status FROM collection_runs WHERE kind = 'catalog'")
      .first<{ status: string }>();
    expect(cat?.status).toBe('ok');
  });

  it('records a failed catalog refresh but still prunes', async () => {
    await seedBtc();
    const f = recordingFetcher(() => new Response('boom', { status: 500 }));
    await maintenance({
      db,
      marketData: adapter(f.fetcher),
      symbols: new D1SymbolStore(db),
      obs: new InMemoryObservabilitySink(),
      clock: new FakeClock(T),
      retentionDays: 7,
      runsRetentionDays: 30,
      rollups1hRetentionDays: 90,
    });
    const cat = await db
      .prepare("SELECT status FROM collection_runs WHERE kind = 'catalog'")
      .first<{ status: string }>();
    expect(cat?.status).toBe('failed');
    const prune = await db
      .prepare("SELECT status FROM collection_runs WHERE kind = 'prune'")
      .first<{ status: string }>();
    expect(prune?.status).toBe('ok');
  });

  it('prunes rollups_1h past retention', async () => {
    const btc = await seedBtc();
    const ins = `INSERT INTO rollups_1h
      (symbol_id, hour_ts, open_minor, high_minor, low_minor, close_minor, price_scale_used, sample_count, finalized)
      VALUES (?, ?, 1, 1, 1, 1, 2, 1, 1)`;
    await db
      .prepare(ins)
      .bind(btc, T - 100 * DAY)
      .run(); // older than 90d
    await db
      .prepare(ins)
      .bind(btc, T - HOUR)
      .run(); // recent
    const f = recordingFetcher(() => Response.json({ error: 0, result: [] }));
    await maintenance({
      db,
      marketData: adapter(f.fetcher),
      symbols: new D1SymbolStore(db),
      obs: new InMemoryObservabilitySink(),
      clock: new FakeClock(T),
      retentionDays: 7,
      runsRetentionDays: 30,
      rollups1hRetentionDays: 90,
    });
    const n = await db.prepare('SELECT COUNT(*) AS n FROM rollups_1h').first<{ n: number }>();
    expect(n?.n).toBe(1); // old hourly candle pruned, recent kept
  });
});
