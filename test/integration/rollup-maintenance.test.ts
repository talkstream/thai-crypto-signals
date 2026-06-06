import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BitkubAdapter } from '../../src/adapters/bitkub/client';
import { D1SymbolStore } from '../../src/adapters/storage/symbol-store';
import { maintenance } from '../../src/collector/maintenance';
import { gmt7DayStart, hourStart, rollup } from '../../src/collector/rollup-job';
import { FakeClock, FakeRng, InMemoryObservabilitySink } from '../helpers/fakes';
import { resetDb } from '../helpers/migrate';

const db = env.DB;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const T = 1_700_000_000_000;

beforeEach(async () => {
  await resetDb(db);
});
afterEach(() => {
  vi.restoreAllMocks();
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
});

describe('maintenance', () => {
  function adapter(): BitkubAdapter {
    return new BitkubAdapter({
      baseUrl: 'https://api.bitkub.com',
      timeoutMs: 8000,
      clock: new FakeClock(0),
      rng: new FakeRng(0.5),
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

    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
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
      ),
    );

    const store = new D1SymbolStore(db);
    await maintenance({
      db,
      marketData: adapter(),
      symbols: store,
      obs: new InMemoryObservabilitySink(),
      clock: new FakeClock(T),
      retentionDays: 7,
      runsRetentionDays: 30,
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
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response('boom', { status: 500 })),
    );
    await maintenance({
      db,
      marketData: adapter(),
      symbols: new D1SymbolStore(db),
      obs: new InMemoryObservabilitySink(),
      clock: new FakeClock(T),
      retentionDays: 7,
      runsRetentionDays: 30,
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
});
