import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { BitkubAdapter } from '../../src/adapters/bitkub/client';
import { KvCacheWriter } from '../../src/adapters/storage/cache-writer';
import { D1CollectStore } from '../../src/adapters/storage/collect-store';
import { D1SymbolStore } from '../../src/adapters/storage/symbol-store';
import { type CollectDeps, collect } from '../../src/collector/collect';
import { bucketTsFor } from '../../src/config/cadence';
import type { CollectStore, Fetcher } from '../../src/domain/ports';
import type { RunRecord } from '../../src/domain/types';
import {
  FakeClock,
  FakeRng,
  InMemoryCacheWriter,
  InMemoryObservabilitySink,
  InMemorySignalDispatcher,
  recordingFetcher,
} from '../helpers/fakes';
import { resetDb } from '../helpers/migrate';

const db = env.DB;
const CADENCE = 2;
const SERVER_MS = 1_700_000_040_000;
const BUCKET = bucketTsFor(SERVER_MS, CADENCE);
const PRIOR_BUCKET = BUCKET - 60_000 * CADENCE;

beforeEach(async () => {
  await resetDb(db);
  await env.CACHE.delete('latest:v1');
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

// The network edge is INJECTED (contract replay), never patched: routeFetch sets the Fetcher that
// the next makeDeps() wires into the adapter. No vi.spyOn, no global mutation.
function handlerFor(routes: Routes): (url: string) => Response | Promise<Response> {
  return (url: string) => {
    const pick = url.includes('/servertime')
      ? (routes.servertime ?? (() => Response.json(SERVER_MS)))
      : url.includes('/market/symbols')
        ? (routes.symbols ?? (() => Response.json({ error: 0, result: [symbolEntry()] })))
        : url.includes('/market/ticker')
          ? (routes.ticker ?? (() => Response.json([tickerEntry()])))
          : null;
    if (!pick) throw new Error(`unexpected url ${url}`);
    return pick();
  };
}
let routedFetcher: Fetcher = recordingFetcher(handlerFor({})).fetcher;
function routeFetch(routes: Routes): void {
  routedFetcher = recordingFetcher(handlerFor(routes)).fetcher;
}

function makeDeps(over: Partial<CollectDeps> = {}): CollectDeps {
  return {
    marketData: new BitkubAdapter({
      baseUrl: 'https://api.bitkub.com',
      timeoutMs: 8000,
      clock: new FakeClock(0),
      rng: new FakeRng(0.5),
      fetcher: routedFetcher,
    }),
    symbols: new D1SymbolStore(db),
    store: new D1CollectStore(db),
    cache: new KvCacheWriter(env.CACHE),
    obs: new InMemoryObservabilitySink(),
    clock: new FakeClock(SERVER_MS),
    cadenceMinutes: CADENCE,
    dispatcher: new InMemorySignalDispatcher(),
    signalsEnabled: false,
    signalThresholdBp: 300, // 3% — a symbol moving >= this vs the prior bucket is a mover
    signalWatchlist: new Set<string>(), // empty = all symbols (no filtering) by default
    ...over,
  };
}

// Seed a prior-bucket snapshot so the current tick can be measured against it (for the mover rule).
async function seedPriorSnapshot(symbol: string, lastMinor: number, scale = 2): Promise<void> {
  const id = (await new D1SymbolStore(db).loadMap()).get(symbol)?.id;
  if (!id) throw new Error(`seed prior: ${symbol} not in catalog`);
  await db
    .prepare(
      `INSERT INTO ticker_snapshots
         (symbol_id, bucket_ts, observed_ms, last_minor, high_minor, low_minor, price_scale_used,
          base_volume, quote_volume, pct_change_bp, ingested_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, '1', '1', 0, ?)`,
    )
    .bind(id, PRIOR_BUCKET, PRIOR_BUCKET, lastMinor, lastMinor, lastMinor, scale, PRIOR_BUCKET)
    .run();
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
    const obs = new InMemoryObservabilitySink();
    await collect(makeDeps({ obs })); // real KV via KvCacheWriter

    expect(await runStatus()).toBe('ok');
    expect(await snapshotCount()).toBe(2);
    expect(await env.CACHE.get('latest:v1')).not.toBeNull();
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

  it('ignores an implausibly skewed (far-future) server time, using the local clock', async () => {
    await seedSymbols();
    routeFetch({ servertime: () => Response.json(SERVER_MS + 600_000) }); // +10 min skew
    await collect(makeDeps());
    const row = await db
      .prepare("SELECT skew_ms FROM collection_runs WHERE bucket_ts = ? AND kind = 'collect'")
      .bind(BUCKET) // bucket came from the local clock, not the poisoned future time
      .first<{ skew_ms: number | null }>();
    expect(row).not.toBeNull();
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

  it('does NOT emit a sanity_jump when only the scale changes (same price)', async () => {
    await seedSymbols(); // BTC catalog scale 2
    const btc = (await new D1SymbolStore(db).loadMap()).get('BTC_THB');
    if (!btc) throw new Error('seed failed');
    // prior stored at scale 1 with the same decimal price (2017050.8)
    await db
      .prepare(
        `INSERT INTO ticker_snapshots
          (symbol_id, bucket_ts, observed_ms, last_minor, high_minor, low_minor, price_scale_used,
           base_volume, quote_volume, pct_change_bp, ingested_ms)
         VALUES (?, ?, ?, 20170508, 20170508, 20170508, 1, '1', '1', 0, ?)`,
      )
      .bind(btc.id, PRIOR_BUCKET, PRIOR_BUCKET, PRIOR_BUCKET)
      .run();
    routeFetch({ ticker: () => Response.json([tickerEntry({ last: '2017050.80' })]) });
    const obs = new InMemoryObservabilitySink();
    await collect(makeDeps({ obs }));
    expect(obs.events.some((e) => e.kind === 'sanity_jump')).toBe(false);
  });

  it('dedupes a duplicate symbol within one tick (KV/D1 stay consistent)', async () => {
    await seedSymbols();
    routeFetch({ ticker: () => Response.json([tickerEntry(), tickerEntry({ last: '1.00' })]) }); // two BTC_THB
    await collect(makeDeps());
    expect(await snapshotCount()).toBe(1);
    const row = await db
      .prepare("SELECT rows_inserted, rows_skipped FROM collection_runs WHERE kind = 'collect'")
      .first<{ rows_inserted: number; rows_skipped: number }>();
    expect(row?.rows_inserted).toBe(1);
    expect(row?.rows_skipped).toBe(1); // the duplicate counted as skipped
    const cached = await env.CACHE.get('latest:v1');
    const entries = (
      JSON.parse(cached ?? '{"entries":[]}') as { entries: Array<{ symbol: string }> }
    ).entries;
    expect(entries.filter((e) => e.symbol === 'BTC_THB').length).toBe(1);
  });

  it('a malformed first duplicate does not block a valid later one', async () => {
    await seedSymbols();
    routeFetch({
      ticker: () =>
        Response.json([tickerEntry({ last: 'abc' }), tickerEntry({ last: '2017050.88' })]),
    });
    await collect(makeDeps());
    expect(await snapshotCount()).toBe(1);
    const row = await db
      .prepare('SELECT last_minor FROM ticker_snapshots WHERE bucket_ts = ?')
      .bind(BUCKET)
      .first<{ last_minor: number }>();
    expect(row?.last_minor).toBe(201705088); // the valid second entry was collected
  });

  it('emits an overlap event and does NOT update KV on a duplicate fire', async () => {
    await seedSymbols();
    routeFetch({ ticker: () => Response.json([tickerEntry()]) });
    await collect(makeDeps());
    const before = await env.CACHE.get('latest:v1');
    // duplicate fire for the same bucket, with a different price
    routeFetch({ ticker: () => Response.json([tickerEntry({ last: '9999999.99' })]) });
    const obs = new InMemoryObservabilitySink();
    await collect(makeDeps({ obs }));
    expect(obs.events.some((e) => e.kind === 'overlap')).toBe(true);
    expect(await env.CACHE.get('latest:v1')).toBe(before); // KV not overwritten on overlap
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

  it('empty ticker -> empty status, preserving the previous cache', async () => {
    await seedSymbols();
    await env.CACHE.put('latest:v1', '{"bucketTs":1,"writtenAtMs":1,"entries":[]}');
    routeFetch({ ticker: () => Response.json([]) });
    await collect(makeDeps());
    expect(await runStatus()).toBe('empty');
    expect(await env.CACHE.get('latest:v1')).not.toBeNull(); // previous cache untouched
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

describe('collect — signals producer wiring (movers only, DARK by default)', () => {
  it('enqueues a job of ONLY the movers on a successful non-overlap tick when enabled', async () => {
    await seedSymbols([symbolEntry(), symbolEntry({ symbol: 'ETH_THB', base_asset: 'ETH' })]);
    await seedPriorSnapshot('BTC_THB', 100_000_000); // prior 1,000,000.00 vs current 2,017,050.88 -> mover
    await seedPriorSnapshot('ETH_THB', 7_000_000); // prior 70,000.00 vs current 70,000.00 -> flat, NOT a mover
    routeFetch({
      ticker: () =>
        Response.json([tickerEntry(), tickerEntry({ symbol: 'ETH_THB', last: '70000' })]),
    });
    const dispatcher = new InMemorySignalDispatcher();
    await collect(makeDeps({ dispatcher, signalsEnabled: true }));

    expect(dispatcher.jobs.length).toBe(1);
    const job = dispatcher.jobs[0];
    expect(job?.bucketTs).toBe(BUCKET);
    expect(job?.schemaVersion).toBe(2);
    expect(job?.producedAt).toBe(SERVER_MS); // finishedMs from the FakeClock(SERVER_MS)
    // only the mover (ETH flat -> excluded), carried with direction/percent/price detail
    expect(job?.movers).toEqual([
      { symbol: 'BTC_THB', changeBp: 10170, priceMinor: 201_705_088, scale: 2 },
    ]);
  });

  it('respects the watchlist — only watchlisted symbols can be movers', async () => {
    await seedSymbols([symbolEntry(), symbolEntry({ symbol: 'ETH_THB', base_asset: 'ETH' })]);
    await seedPriorSnapshot('BTC_THB', 100_000_000); // BTC moves big (a mover by the threshold)
    await seedPriorSnapshot('ETH_THB', 3_500_000); // ETH 35,000 -> 70,000 (+100%) -> also a mover
    routeFetch({
      ticker: () =>
        Response.json([tickerEntry(), tickerEntry({ symbol: 'ETH_THB', last: '70000' })]),
    });
    const dispatcher = new InMemorySignalDispatcher();
    await collect(
      makeDeps({ dispatcher, signalsEnabled: true, signalWatchlist: new Set(['ETH_THB']) }),
    );

    expect(dispatcher.jobs.length).toBe(1);
    // BTC moved too, but the watchlist allows only ETH -> BTC is excluded.
    expect(dispatcher.jobs[0]?.movers.map((m) => m.symbol)).toEqual(['ETH_THB']);
  });

  it('a watchlisted symbol that does NOT move enough still produces no signal', async () => {
    await seedSymbols();
    await seedPriorSnapshot('BTC_THB', 201_705_088); // prior == current -> 0% move, below threshold
    routeFetch({ ticker: () => Response.json([tickerEntry()]) });
    const dispatcher = new InMemorySignalDispatcher();
    await collect(
      makeDeps({ dispatcher, signalsEnabled: true, signalWatchlist: new Set(['BTC_THB']) }),
    );

    expect(dispatcher.jobs.length).toBe(0); // in the watchlist, but the threshold still gates it
  });

  it('does NOT enqueue when no symbol moved enough', async () => {
    await seedSymbols();
    await seedPriorSnapshot('BTC_THB', 201_705_088); // prior == current -> 0% move, not a mover
    routeFetch({ ticker: () => Response.json([tickerEntry()]) });
    const dispatcher = new InMemorySignalDispatcher();
    await collect(makeDeps({ dispatcher, signalsEnabled: true }));

    expect(await snapshotCount()).toBe(1); // tick still collected
    expect(dispatcher.jobs.length).toBe(0); // ...but produced no signal
  });

  it('does NOT enqueue when signals are disabled (intent only)', async () => {
    await seedSymbols();
    await seedPriorSnapshot('BTC_THB', 100_000_000); // BTC is a mover
    routeFetch({ ticker: () => Response.json([tickerEntry()]) });
    const dispatcher = new InMemorySignalDispatcher();
    const obs = new InMemoryObservabilitySink();
    await collect(makeDeps({ dispatcher, obs, signalsEnabled: false }));

    expect(dispatcher.jobs.length).toBe(0);
    expect(obs.events.some((e) => e.kind === 'signal_intent')).toBe(true);
  });

  it('does NOT enqueue on an overlap (duplicate-fire) tick', async () => {
    await seedSymbols();
    await seedPriorSnapshot('BTC_THB', 100_000_000); // BTC is a mover on both fires
    routeFetch({ ticker: () => Response.json([tickerEntry()]) });
    await collect(makeDeps({ signalsEnabled: true })); // first writer
    const dispatcher = new InMemorySignalDispatcher();
    await collect(makeDeps({ dispatcher, signalsEnabled: true })); // duplicate fire -> overlap

    expect(dispatcher.jobs.length).toBe(0);
  });

  it('surfaces an invalid (non-finite) threshold and stays dark (no signal)', async () => {
    await seedSymbols();
    await seedPriorSnapshot('BTC_THB', 100_000_000); // BTC would move +101% under a valid threshold
    routeFetch({ ticker: () => Response.json([tickerEntry()]) });
    const dispatcher = new InMemorySignalDispatcher();
    const obs = new InMemoryObservabilitySink();
    // Number("Infinity") / Number("1e309") -> Infinity: must be rejected, not silently dark.
    await collect(
      makeDeps({
        dispatcher,
        obs,
        signalsEnabled: true,
        signalThresholdBp: Number.POSITIVE_INFINITY,
      }),
    );

    expect(obs.events.some((e) => e.kind === 'signal_config_invalid')).toBe(true);
    expect(dispatcher.jobs.length).toBe(0); // an invalid threshold makes no symbol a mover
  });

  it('treats a non-positive prior as no baseline (no mover)', async () => {
    await seedSymbols();
    await seedPriorSnapshot('BTC_THB', 0); // degenerate zero prior -> priorNorm <= 0 -> guard skips it
    routeFetch({ ticker: () => Response.json([tickerEntry()]) });
    const dispatcher = new InMemorySignalDispatcher();
    await collect(makeDeps({ dispatcher, signalsEnabled: true }));

    expect(await snapshotCount()).toBe(1); // still collected
    expect(dispatcher.jobs.length).toBe(0); // no positive baseline -> not a mover -> no signal
  });

  it('does NOT enqueue when zero symbols were collected (all drift)', async () => {
    await seedSymbols();
    routeFetch({ ticker: () => Response.json([tickerEntry({ last: 'abc' })]) }); // -> drift, 0 rows
    const dispatcher = new InMemorySignalDispatcher();
    await collect(makeDeps({ dispatcher, signalsEnabled: true }));

    expect(await runStatus()).toBe('drift');
    expect(dispatcher.jobs.length).toBe(0);
  });

  it('swallows an enqueue failure (best-effort): the tick still commits', async () => {
    await seedSymbols();
    await seedPriorSnapshot('BTC_THB', 100_000_000); // BTC is a mover -> the producer is called
    routeFetch({ ticker: () => Response.json([tickerEntry()]) });
    const dispatcher = new InMemorySignalDispatcher();
    dispatcher.throwOnEnqueue = true;
    const obs = new InMemoryObservabilitySink();
    await expect(
      collect(makeDeps({ dispatcher, obs, signalsEnabled: true })),
    ).resolves.toBeUndefined();

    expect(await snapshotCount()).toBe(1); // tick committed despite the enqueue failure
    expect(obs.events.some((e) => e.kind === 'signal_enqueue_failed')).toBe(true);
  });
});
