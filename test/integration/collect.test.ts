import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BitkubAdapter } from '../../src/adapters/bitkub/client';
import { D1CollectStore } from '../../src/adapters/storage/collect-store';
import { D1SymbolStore } from '../../src/adapters/storage/symbol-store';
import { type CollectDeps, collect } from '../../src/collector/collect';
import { bucketTsFor } from '../../src/config/cadence';
import type { CollectStore } from '../../src/domain/ports';
import type { RunRecord } from '../../src/domain/types';
import {
  FakeClock,
  FakeRng,
  InMemoryCacheWriter,
  InMemoryObservabilitySink,
} from '../helpers/fakes';
import { resetDb } from '../helpers/migrate';

const db = env.DB;
const CADENCE = 2;
const SERVER_MS = 1_700_000_040_000;
const BUCKET = bucketTsFor(SERVER_MS, CADENCE);
const PRIOR_BUCKET = BUCKET - 60_000 * CADENCE;

beforeEach(async () => {
  await resetDb(db);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function tickerEntry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol: 'BTC_THB',
    last: '2017050.88',
    high_24_hr: '2071651',
    low_24_hr: '1950000',
    highest_bid: '2017050.88',
    lowest_ask: '2017617.96',
    base_volume: '300.4',
    quote_volume: '600192397.43',
    percent_change: '-0.94',
    ...over,
  };
}

function symbolEntry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol: 'BTC_THB',
    base_asset: 'BTC',
    quote_asset: 'THB',
    base_asset_scale: 8,
    price_scale: 2,
    quote_asset_scale: 2,
    market_segment: 'SPOT',
    status: 'active',
    ...over,
  };
}

interface Routes {
  servertime?: () => Response | Promise<Response>;
  symbols?: () => Response | Promise<Response>;
  ticker?: () => Response | Promise<Response>;
}

function routeFetch(routes: Routes) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    const pick = url.includes('/servertime')
      ? (routes.servertime ?? (() => Response.json(SERVER_MS)))
      : url.includes('/market/symbols')
        ? (routes.symbols ?? (() => Response.json({ error: 0, result: [symbolEntry()] })))
        : url.includes('/market/ticker')
          ? (routes.ticker ?? (() => Response.json([tickerEntry()])))
          : null;
    if (!pick) throw new Error(`unexpected url ${url}`);
    return Promise.resolve(pick());
  });
}

function makeDeps(over: Partial<CollectDeps> = {}): CollectDeps {
  return {
    marketData: new BitkubAdapter({
      baseUrl: 'https://api.bitkub.com',
      timeoutMs: 8000,
      clock: new FakeClock(0),
      rng: new FakeRng(0.5),
    }),
    symbols: new D1SymbolStore(db),
    store: new D1CollectStore(db),
    cache: new InMemoryCacheWriter(),
    obs: new InMemoryObservabilitySink(),
    clock: new FakeClock(SERVER_MS),
    cadenceMinutes: CADENCE,
    ...over,
  };
}

async function seedSymbols(entries: Record<string, unknown>[] = [symbolEntry()]): Promise<void> {
  const store = new D1SymbolStore(db);
  await store.upsertMany(
    entries.map((e) => ({
      symbol: e.symbol as string,
      baseAsset: e.base_asset as string,
      quoteAsset: e.quote_asset as string,
      priceScale: e.price_scale as number,
      quoteScale: e.quote_asset_scale as number,
      marketSegment: e.market_segment as string,
      status: e.status as string,
    })),
    1,
  );
}

async function runStatus(): Promise<string | undefined> {
  const row = await db
    .prepare('SELECT status FROM collection_runs WHERE bucket_ts = ? AND kind = ?')
    .bind(BUCKET, 'collect')
    .first<{ status: string }>();
  return row?.status;
}

async function snapshotCount(): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM ticker_snapshots WHERE bucket_ts = ?')
    .bind(BUCKET)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe('collect — happy path & catalog', () => {
  it('collects valid entries, writes run=ok, KV latest, and an AE run metric', async () => {
    await seedSymbols([symbolEntry(), symbolEntry({ symbol: 'ETH_THB', base_asset: 'ETH' })]);
    routeFetch({
      ticker: () =>
        Response.json([tickerEntry(), tickerEntry({ symbol: 'ETH_THB', last: '70000' })]),
    });
    const cache = new InMemoryCacheWriter();
    const obs = new InMemoryObservabilitySink();
    await collect(makeDeps({ cache, obs }));

    expect(await runStatus()).toBe('ok');
    expect(await snapshotCount()).toBe(2);
    expect(cache.store.has('latest:v1')).toBe(true);
    expect(obs.runs.length).toBe(1);
  });

  it('bootstraps an empty catalog by fetching symbols first', async () => {
    routeFetch({}); // default symbols + servertime + ticker
    await collect(makeDeps());
    const catalog = await db.prepare('SELECT COUNT(*) AS n FROM symbols').first<{ n: number }>();
    expect(catalog?.n).toBe(1);
    expect(await snapshotCount()).toBe(1);
  });

  it('falls back to local clock when servertime fails (serverTsMs null)', async () => {
    await seedSymbols();
    routeFetch({ servertime: () => new Response('boom', { status: 500 }) });
    await collect(makeDeps());
    const row = await db
      .prepare('SELECT server_ts_ms, skew_ms FROM collection_runs WHERE kind = ?')
      .bind('collect')
      .first<{ server_ts_ms: number | null; skew_ms: number | null }>();
    expect(row?.server_ts_ms).toBeNull();
    expect(row?.skew_ms).toBeNull();
  });
});

describe('collect — per-entry tolerance', () => {
  it('counts drift for unlisted and malformed entries (status partial)', async () => {
    await seedSymbols();
    routeFetch({
      ticker: () =>
        Response.json([
          tickerEntry(), // valid BTC
          tickerEntry({ symbol: 'UNLISTED_THB' }), // not in catalog -> drift
          { symbol: 'BAD_THB', last: 123 }, // malformed -> drift
        ]),
    });
    await collect(makeDeps());
    expect(await runStatus()).toBe('partial');
    expect(await snapshotCount()).toBe(1);
    const row = await db
      .prepare('SELECT drift_count FROM collection_runs WHERE kind = ?')
      .bind('collect')
      .first<{ drift_count: number }>();
    expect(row?.drift_count).toBe(2);
  });

  it('counts a non-numeric price string as drift (mapEntry DecimalParse)', async () => {
    await seedSymbols();
    routeFetch({ ticker: () => Response.json([tickerEntry({ last: 'abc' })]) });
    await collect(makeDeps());
    expect(await runStatus()).toBe('drift');
    const row = await db
      .prepare('SELECT drift_count FROM collection_runs WHERE kind = ?')
      .bind('collect')
      .first<{ drift_count: number }>();
    expect(row?.drift_count).toBe(1);
  });

  it('skips a scale-overflow entry and emits an AE event', async () => {
    await seedSymbols([
      symbolEntry({ symbol: 'BABYDOGE_THB', base_asset: 'BABYDOGE', price_scale: 13 }),
    ]);
    routeFetch({
      ticker: () => Response.json([tickerEntry({ symbol: 'BABYDOGE_THB', last: '1000000' })]),
    });
    const obs = new InMemoryObservabilitySink();
    await collect(makeDeps({ obs }));
    expect(await runStatus()).toBe('drift'); // 0 inserted, 1 skipped
    expect(obs.events.some((e) => e.kind === 'scale_overflow')).toBe(true);
  });

  it('stores a one-sided book as NULL bid/ask', async () => {
    await seedSymbols();
    routeFetch({
      ticker: () => Response.json([tickerEntry({ highest_bid: '0', lowest_ask: '' })]),
    });
    await collect(makeDeps());
    const row = await db
      .prepare('SELECT bid_minor, ask_minor FROM ticker_snapshots WHERE bucket_ts = ?')
      .bind(BUCKET)
      .first<{ bid_minor: number | null; ask_minor: number | null }>();
    expect(row?.bid_minor).toBeNull();
    expect(row?.ask_minor).toBeNull();
  });

  it('emits a sanity_jump event on a >=10x move vs the prior bucket', async () => {
    await seedSymbols();
    const map = await new D1SymbolStore(db).loadMap();
    const btc = map.get('BTC_THB');
    if (!btc) throw new Error('seed failed');
    await new D1CollectStore(db).commitCollect(
      [
        {
          symbolId: btc.id,
          bucketTs: PRIOR_BUCKET,
          observedMs: PRIOR_BUCKET,
          lastMinor: 100_00n, // 100.00 THB
          highMinor: 100_00n,
          lowMinor: 100_00n,
          bidMinor: null,
          askMinor: null,
          priceScaleUsed: 2,
          baseVolume: '1',
          quoteVolume: '1',
          pctChangeBp: 0,
        },
      ],
      {
        bucketTs: PRIOR_BUCKET,
        kind: 'collect',
        status: 'ok',
        startedMs: PRIOR_BUCKET,
        finishedMs: PRIOR_BUCKET,
        serverTsMs: PRIOR_BUCKET,
        symbolsSeen: 1,
        rowsInserted: 1,
        rowsSkipped: 0,
        driftCount: 0,
        scaleOverflowCount: 0,
        rowsWritten: 2,
        skewMs: 0,
        httpStatus: 200,
        durationMs: 0,
        errorDetail: null,
      } satisfies RunRecord,
    );
    // now last = 2,017,050.88 THB >> 10 * 100 THB
    routeFetch({ ticker: () => Response.json([tickerEntry()]) });
    const obs = new InMemoryObservabilitySink();
    await collect(makeDeps({ obs }));
    expect(obs.events.some((e) => e.kind === 'sanity_jump')).toBe(true);
  });

  it('emits a sanity_jump on a >=10x DOWNWARD move', async () => {
    await seedSymbols();
    const btc = (await new D1SymbolStore(db).loadMap()).get('BTC_THB');
    if (!btc) throw new Error('seed');
    await db
      .prepare(
        `INSERT INTO ticker_snapshots
          (symbol_id, bucket_ts, observed_ms, last_minor, high_minor, low_minor, price_scale_used,
           base_volume, quote_volume, pct_change_bp, ingested_ms)
         VALUES (?, ?, ?, 201705088, 201705088, 201705088, 2, '1', '1', 0, ?)`,
      )
      .bind(btc.id, PRIOR_BUCKET, PRIOR_BUCKET, PRIOR_BUCKET)
      .run();
    routeFetch({ ticker: () => Response.json([tickerEntry({ last: '100.00' })]) });
    const obs = new InMemoryObservabilitySink();
    await collect(makeDeps({ obs }));
    expect(obs.events.some((e) => e.kind === 'sanity_jump')).toBe(true);
  });

  it('emits an overlap event on a duplicate fire', async () => {
    await seedSymbols();
    routeFetch({ ticker: () => Response.json([tickerEntry()]) });
    await collect(makeDeps());
    const obs = new InMemoryObservabilitySink();
    await collect(makeDeps({ obs }));
    expect(obs.events.some((e) => e.kind === 'overlap')).toBe(true);
  });
});

describe('collect — fetch failures become terminal run rows', () => {
  it('429 -> rate_limited', async () => {
    await seedSymbols();
    routeFetch({ ticker: () => new Response('rl', { status: 429 }) });
    await collect(makeDeps());
    const row = await db
      .prepare('SELECT status, http_status FROM collection_runs WHERE kind = ?')
      .bind('collect')
      .first<{ status: string; http_status: number | null }>();
    expect(row?.status).toBe('rate_limited');
    expect(row?.http_status).toBe(429);
  });

  it('5xx (twice) -> http_error', async () => {
    await seedSymbols();
    routeFetch({ ticker: () => new Response('boom', { status: 503 }) });
    await collect(makeDeps());
    expect(await runStatus()).toBe('http_error');
  });

  it('non-array envelope -> drift', async () => {
    await seedSymbols();
    routeFetch({ ticker: () => Response.json({ error: 3 }) });
    await collect(makeDeps());
    expect(await runStatus()).toBe('drift');
  });

  it('network-unreachable -> fetch_failed', async () => {
    await seedSymbols();
    routeFetch({
      ticker: () => {
        throw new TypeError('network down');
      },
    });
    await collect(makeDeps());
    expect(await runStatus()).toBe('fetch_failed');
  });

  it('timeout -> timeout', async () => {
    await seedSymbols();
    routeFetch({
      ticker: () => {
        throw new DOMException('timed out', 'TimeoutError');
      },
    });
    await collect(makeDeps());
    expect(await runStatus()).toBe('timeout');
  });
});

describe('collect — best-effort sinks never fail the tick', () => {
  it('swallows a KV put failure', async () => {
    await seedSymbols();
    routeFetch({ ticker: () => Response.json([tickerEntry()]) });
    const cache = new InMemoryCacheWriter();
    cache.throwOnPut = true;
    await expect(collect(makeDeps({ cache }))).resolves.toBeUndefined();
    expect(await snapshotCount()).toBe(1); // tick still committed
  });

  it('swallows an Analytics Engine failure', async () => {
    await seedSymbols();
    routeFetch({ ticker: () => Response.json([tickerEntry()]) });
    const obs = new InMemoryObservabilitySink();
    obs.throwOnWrite = true;
    await expect(collect(makeDeps({ obs }))).resolves.toBeUndefined();
    expect(await snapshotCount()).toBe(1);
  });

  it('reports store_error when the atomic batch throws', async () => {
    await seedSymbols();
    routeFetch({ ticker: () => Response.json([tickerEntry()]) });
    const inner = new D1CollectStore(db);
    const throwing: CollectStore = {
      priorLastBySymbol: (b) => inner.priorLastBySymbol(b),
      commitCollect: () => {
        throw new Error('db down');
      },
      failRun: (r) => inner.failRun(r),
    };
    await expect(collect(makeDeps({ store: throwing }))).resolves.toBeUndefined();
    expect(await runStatus()).toBe('store_error');
    expect(await snapshotCount()).toBe(0);
  });
});
