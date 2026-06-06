import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { D1ReadStore, type ReadStore } from '../../src/adapters/storage/read-store';
import { D1SymbolStore } from '../../src/adapters/storage/symbol-store';
import { type ApiDeps, handleRequest } from '../../src/api/router';
import { FakeClock } from '../helpers/fakes';
import { resetDb } from '../helpers/migrate';

const db = env.DB;
const NOW = 1_700_000_000_000;
const FRESH_MS = 240_000;

beforeEach(async () => {
  await resetDb(db);
  await env.CACHE.delete('latest:v1');
});

function deps(over: Partial<ApiDeps> = {}): ApiDeps {
  return {
    store: new D1ReadStore(db),
    cache: env.CACHE,
    clock: new FakeClock(NOW),
    freshMs: FRESH_MS,
    ...over,
  };
}

async function seedSymbols(): Promise<Map<string, number>> {
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
      {
        symbol: 'ETH_THB',
        baseAsset: 'ETH',
        quoteAsset: 'THB',
        priceScale: 2,
        quoteScale: 2,
        marketSegment: 'SPOT',
        status: 'active',
      },
    ],
    1,
  );
  const map = await store.loadMap();
  return new Map([...map.values()].map((s) => [s.symbol, s.id]));
}

async function insertSnap(
  symbolId: number,
  bucketTs: number,
  last: number,
  bid: number | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ticker_snapshots
        (symbol_id, bucket_ts, observed_ms, last_minor, high_minor, low_minor, bid_minor, ask_minor,
         price_scale_used, base_volume, quote_volume, pct_change_bp, ingested_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2, '1', '1', 0, ?)`,
    )
    .bind(symbolId, bucketTs, bucketTs, last, last, last, bid, bid, bucketTs)
    .run();
}

async function get(path: string, d = deps()): Promise<Response> {
  return handleRequest(new Request(`https://x${path}`), d);
}

describe('GET /health', () => {
  it('reports freshness and counts', async () => {
    const ids = await seedSymbols();
    const btc = ids.get('BTC_THB');
    if (btc === undefined) throw new Error('seed');
    await insertSnap(btc, NOW - 60_000, 200000000, 199000000);
    await db
      .prepare(
        `INSERT INTO collection_runs (bucket_ts, kind, status, started_ms, finished_ms, server_ts_ms,
          symbols_seen, rows_inserted, rows_skipped, drift_count, scale_overflow_count, rows_written,
          skew_ms, http_status, duration_ms, error_detail)
         VALUES (?, 'collect', 'ok', ?, ?, ?, 2, 2, 0, 1, 0, 3, 0, 200, 5, NULL)`,
      )
      .bind(NOW - 60_000, NOW - 60_000, NOW - 59_000, NOW - 60_000)
      .run();
    const res = await get('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      symbolCount: number;
      recentDrift: number;
      lastCollectStatus: string;
    };
    expect(body.ok).toBe(true);
    expect(body.symbolCount).toBe(2);
    expect(body.recentDrift).toBe(1);
    expect(body.lastCollectStatus).toBe('ok');
  });
});

describe('GET /v1/symbols', () => {
  it('lists the catalog sorted', async () => {
    await seedSymbols();
    const res = await get('/v1/symbols');
    const body = (await res.json()) as { symbols: Array<{ symbol: string }> };
    expect(body.symbols.map((s) => s.symbol)).toEqual(['BTC_THB', 'ETH_THB']);
  });
});

describe('GET /v1/tickers/latest', () => {
  async function seedLatest(): Promise<void> {
    const ids = await seedSymbols();
    const btc = ids.get('BTC_THB');
    const eth = ids.get('ETH_THB');
    if (btc === undefined || eth === undefined) throw new Error('seed');
    await insertSnap(btc, NOW - 60_000, 200000000, 199000000);
    await insertSnap(eth, NOW - 60_000, 7000000, null);
  }

  it('rebuilds from D1 on a cache miss', async () => {
    await seedLatest();
    const res = await get('/v1/tickers/latest');
    const body = (await res.json()) as {
      entries: Array<{ symbol: string; last: string; bid: string | null }>;
    };
    expect(body.entries.map((e) => e.symbol)).toEqual(['BTC_THB', 'ETH_THB']);
    expect(body.entries[1]?.bid).toBeNull(); // ETH one-sided
  });

  it('a cache hit is byte-identical to a rebuild (parity)', async () => {
    await seedLatest();
    const missText = await (await get('/v1/tickers/latest')).text();
    // scramble order + add writtenAtMs, then serve from cache
    const parsed = JSON.parse(missText) as { bucketTs: number; entries: unknown[] };
    await env.CACHE.put(
      'latest:v1',
      JSON.stringify({
        bucketTs: parsed.bucketTs,
        writtenAtMs: 999,
        entries: [...parsed.entries].reverse(),
      }),
    );
    const hitText = await (await get('/v1/tickers/latest')).text();
    expect(hitText).toBe(missText);
  });

  it('falls back to a rebuild on a corrupt cache value', async () => {
    await seedLatest();
    const missText = await (await get('/v1/tickers/latest')).text();
    await env.CACHE.put('latest:v1', 'not-json{');
    const hitText = await (await get('/v1/tickers/latest')).text();
    expect(hitText).toBe(missText);
  });
});

describe('GET /v1/tickers/:symbol', () => {
  it('returns history points', async () => {
    const ids = await seedSymbols();
    const btc = ids.get('BTC_THB');
    if (btc === undefined) throw new Error('seed');
    await insertSnap(btc, NOW - 120_000, 200000000, 199000000);
    await insertSnap(btc, NOW - 60_000, 201000000, 200000000);
    const res = await get('/v1/tickers/BTC_THB?limit=10');
    const body = (await res.json()) as { symbol: string; points: Array<{ last: string }> };
    expect(body.symbol).toBe('BTC_THB');
    expect(body.points.length).toBe(2);
    expect(body.points[0]?.last).toBe('2010000'); // newest first, formatted
  });

  it('404s an unknown symbol', async () => {
    await seedSymbols();
    const res = await get('/v1/tickers/NOPE_THB');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('symbol_not_found');
  });

  it('returns rollups', async () => {
    const ids = await seedSymbols();
    const btc = ids.get('BTC_THB');
    if (btc === undefined) throw new Error('seed');
    await db
      .prepare(
        `INSERT INTO rollups_1h (symbol_id, hour_ts, open_minor, high_minor, low_minor, close_minor, price_scale_used, sample_count, finalized)
         VALUES (?, ?, 100, 300, 100, 200, 2, 3, 1)`,
      )
      .bind(btc, NOW - 3_600_000)
      .run();
    const res = await get('/v1/tickers/BTC_THB/rollups?interval=1h&limit=5');
    const body = (await res.json()) as { points: Array<{ open: string; finalized: boolean }> };
    expect(body.points.length).toBe(1);
    expect(body.points[0]?.open).toBe('1');
    expect(body.points[0]?.finalized).toBe(true);
  });
});

describe('routing edges', () => {
  it('404s an unknown path', async () => {
    expect((await get('/v1/nope')).status).toBe(404);
  });

  it('answers OPTIONS with CORS', async () => {
    const res = await handleRequest(new Request('https://x/health', { method: 'OPTIONS' }), deps());
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('500s on an internal store error', async () => {
    const throwing: ReadStore = {
      health: () => Promise.reject(new Error('db down')),
      listSymbols: () => Promise.reject(new Error('x')),
      latest: () => Promise.reject(new Error('x')),
      history: () => Promise.reject(new Error('x')),
      rollups: () => Promise.reject(new Error('x')),
    };
    const res = await get('/health', deps({ store: throwing }));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe('internal_error');
  });
});

describe('read API on an empty / sparse DB', () => {
  it('health reports not-ok with null fields', async () => {
    const body = (await (await get('/health')).json()) as {
      ok: boolean;
      lastCollectStatus: string | null;
      lastObservedMs: number | null;
      symbolCount: number;
    };
    expect(body.ok).toBe(false);
    expect(body.lastCollectStatus).toBeNull();
    expect(body.lastObservedMs).toBeNull();
    expect(body.symbolCount).toBe(0);
  });

  it('latest is empty with bucketTs 0', async () => {
    const body = JSON.parse(await (await get('/v1/tickers/latest')).text()) as {
      bucketTs: number;
      stale: boolean;
      entries: unknown[];
    };
    expect(body.bucketTs).toBe(0);
    expect(body.stale).toBe(true); // no data -> stale
    expect(body.entries).toEqual([]);
  });

  it('formats a null bid/ask in history', async () => {
    const ids = await seedSymbols();
    const btc = ids.get('BTC_THB');
    if (btc === undefined) throw new Error('seed');
    await insertSnap(btc, NOW - 60_000, 200000000, null);
    const body = (await (await get('/v1/tickers/BTC_THB?limit=5')).json()) as {
      points: Array<{ bid: string | null }>;
    };
    expect(body.points[0]?.bid).toBeNull();
  });

  it('clamps a non-numeric limit to the default', async () => {
    await seedSymbols();
    expect((await get('/v1/tickers/BTC_THB?limit=abc')).status).toBe(200);
  });

  it('returns daily rollups (interval=1d)', async () => {
    const ids = await seedSymbols();
    const btc = ids.get('BTC_THB');
    if (btc === undefined) throw new Error('seed');
    await db
      .prepare(
        `INSERT INTO rollups_1d (symbol_id, day_ts, open_minor, high_minor, low_minor, close_minor, price_scale_used, sample_count, finalized)
         VALUES (?, ?, 100, 300, 100, 200, 2, 5, 0)`,
      )
      .bind(btc, NOW - 86_400_000)
      .run();
    const body = (await (await get('/v1/tickers/BTC_THB/rollups?interval=1d&limit=5')).json()) as {
      interval: string;
      points: Array<{ finalized: boolean }>;
    };
    expect(body.interval).toBe('1d');
    expect(body.points[0]?.finalized).toBe(false);
  });

  it('falls back to a D1 rebuild when the cached latest is stale', async () => {
    const ids = await seedSymbols();
    const btc = ids.get('BTC_THB');
    if (btc === undefined) throw new Error('seed');
    await insertSnap(btc, NOW - 60_000, 200000000, 199000000);
    await env.CACHE.put(
      'latest:v1',
      JSON.stringify({
        bucketTs: NOW - 100 * FRESH_MS,
        entries: [
          { symbol: 'STALE_THB', last: '1', bid: null, ask: null, pctChangeBp: 0, observedMs: 0 },
        ],
      }),
    );
    const body = (await (await get('/v1/tickers/latest')).json()) as {
      entries: Array<{ symbol: string }>;
    };
    expect(body.entries.map((e) => e.symbol)).toEqual(['BTC_THB']); // rebuilt from D1, not stale cache
  });

  it('formats each history row at its own stored scale', async () => {
    const ids = await seedSymbols();
    const btc = ids.get('BTC_THB');
    if (btc === undefined) throw new Error('seed');
    // catalog scale is 2, but this snapshot was stored at scale 4
    await db
      .prepare(
        `INSERT INTO ticker_snapshots
          (symbol_id, bucket_ts, observed_ms, last_minor, high_minor, low_minor, price_scale_used,
           base_volume, quote_volume, pct_change_bp, ingested_ms)
         VALUES (?, ?, ?, 12345, 12345, 12345, 4, '1', '1', 0, ?)`,
      )
      .bind(btc, NOW - 60_000, NOW - 60_000, NOW - 60_000)
      .run();
    const body = (await (await get('/v1/tickers/BTC_THB?limit=5')).json()) as {
      points: Array<{ last: string }>;
    };
    expect(body.points[0]?.last).toBe('1.2345'); // scale 4, not the catalog's scale 2
  });
});
