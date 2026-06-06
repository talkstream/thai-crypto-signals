import { type RawTickerEntry, safeParseTickerEntry } from '../adapters/bitkub/schemas';
import { bucketTsFor } from '../config/cadence';
import { SANITY_JUMP_FACTOR } from '../config/constants';
import { type LatestDto, type LatestEntryDto, toLatestEntry } from '../domain/dto';
import {
  BitkubHttpError,
  BitkubRateLimitedError,
  BitkubTimeoutError,
  PayloadValidationError,
  ScaleOverflowError,
} from '../domain/errors';
import { errMessage, safeEvent } from '../domain/obs';
import type {
  CacheWriter,
  Clock,
  CollectStore,
  MarketDataSource,
  ObservabilitySink,
  SymbolStore,
} from '../domain/ports';
import { parseDecimalToMinor, pctToBasisPoints, rescaleMinor } from '../domain/price';
import type { MarketSymbol, RunRecord, TickerSnapshot } from '../domain/types';

const LATEST_KEY = 'latest:v1';

export interface CollectDeps {
  marketData: MarketDataSource;
  symbols: SymbolStore;
  store: CollectStore;
  cache: CacheWriter;
  obs: ObservabilitySink;
  clock: Clock;
  cadenceMinutes: number;
}

function fetchErrorStatus(e: unknown): string {
  if (e instanceof BitkubRateLimitedError) return 'rate_limited';
  if (e instanceof BitkubTimeoutError) return 'timeout';
  if (e instanceof BitkubHttpError) return 'http_error';
  if (e instanceof PayloadValidationError) return 'drift';
  return 'fetch_failed';
}

function httpStatusOf(e: unknown): number | null {
  if (e instanceof BitkubHttpError) return e.status;
  if (e instanceof BitkubRateLimitedError) return 429;
  return null;
}

function safeRun(obs: ObservabilitySink, run: RunRecord, overlap: boolean): void {
  try {
    obs.writeRun(
      { kind: run.kind, status: run.status },
      {
        symbolsSeen: run.symbolsSeen,
        rowsInserted: run.rowsInserted,
        rowsSkipped: run.rowsSkipped,
        driftCount: run.driftCount,
        scaleOverflowCount: run.scaleOverflowCount,
        rowsWritten: run.rowsWritten,
        durationMs: run.durationMs,
        skewMs: run.skewMs ?? 0,
        overlap: overlap ? 1 : 0,
      },
    );
  } catch {
    // best-effort
  }
}

function parseSide(raw: string, scale: number, symbol: string): bigint | null {
  if (!raw) return null;
  const value = parseDecimalToMinor(raw, scale, symbol);
  return value === 0n ? null : value;
}

function mapEntry(
  entry: RawTickerEntry,
  sym: MarketSymbol,
  bucketTs: number,
  observedMs: number,
): TickerSnapshot {
  const scale = sym.priceScale;
  return {
    symbolId: sym.id,
    bucketTs,
    observedMs,
    lastMinor: parseDecimalToMinor(entry.last, scale, entry.symbol),
    highMinor: parseDecimalToMinor(entry.high_24_hr, scale, entry.symbol),
    lowMinor: parseDecimalToMinor(entry.low_24_hr, scale, entry.symbol),
    bidMinor: parseSide(entry.highest_bid, scale, entry.symbol),
    askMinor: parseSide(entry.lowest_ask, scale, entry.symbol),
    priceScaleUsed: scale,
    baseVolume: entry.base_volume,
    quoteVolume: entry.quote_volume,
    pctChangeBp: pctToBasisPoints(entry.percent_change),
  };
}

function isSanityJump(lastMinor: bigint, priorLast: bigint): boolean {
  return lastMinor >= priorLast * SANITY_JUMP_FACTOR || priorLast >= lastMinor * SANITY_JUMP_FACTOR;
}

async function reportFailure(
  deps: CollectDeps,
  base: { bucketTs: number; startedMs: number; serverTsMs: number | null; skewMs: number | null },
  status: string,
  httpStatus: number | null,
  errorDetail: string,
): Promise<void> {
  const finishedMs = deps.clock.now();
  const run: RunRecord = {
    bucketTs: base.bucketTs,
    kind: 'collect',
    status,
    startedMs: base.startedMs,
    finishedMs,
    serverTsMs: base.serverTsMs,
    symbolsSeen: 0,
    rowsInserted: 0,
    rowsSkipped: 0,
    driftCount: 0,
    scaleOverflowCount: 0,
    rowsWritten: 0,
    skewMs: base.skewMs,
    httpStatus,
    durationMs: finishedMs - base.startedMs,
    errorDetail,
  };
  try {
    await deps.store.failRun(run);
  } catch {
    // failRun is best-effort: if the store itself is down, the gap is surfaced by absence.
  }
  safeRun(deps.obs, run, false);
}

/** One collect tick: server-time-anchored bucket, per-entry mapping, one atomic batch. */
export async function collect(deps: CollectDeps): Promise<void> {
  const { marketData, symbols, store, cache, obs, clock, cadenceMinutes } = deps;
  const startedMs = clock.now();

  // 1. Symbol catalog (bootstrap on an empty DB).
  let map = await symbols.loadMap();
  if (map.size === 0) {
    await symbols.upsertMany(await marketData.getSymbols(), startedMs);
    map = await symbols.loadMap();
  }

  // 2. Authoritative bucket from server time; fall back to the local clock on failure.
  let serverMs: number;
  let skewMs: number | null;
  try {
    serverMs = await marketData.getServerTime();
    skewMs = serverMs - clock.now();
  } catch {
    serverMs = clock.now();
    skewMs = null;
  }
  const bucketTs = bucketTsFor(serverMs, cadenceMinutes);
  const serverTsMs = skewMs === null ? null : serverMs;
  const base = { bucketTs, startedMs, serverTsMs, skewMs };

  // 3. Immediately-preceding bucket (for the 10x sanity check).
  const prior = await store.priorLastBySymbol(bucketTs - 60_000 * cadenceMinutes);

  // 4. Fetch the ticker; a fetch/envelope error becomes a terminal run row.
  let raw: unknown[];
  try {
    raw = await marketData.getTicker();
  } catch (e) {
    await reportFailure(deps, base, fetchErrorStatus(e), httpStatusOf(e), errMessage(e));
    return;
  }

  // An empty ticker is an upstream anomaly, not a successful tick: record it and keep the
  // previous cache rather than overwriting it with nothing.
  if (raw.length === 0) {
    await reportFailure(deps, base, 'empty', 200, 'empty ticker envelope');
    return;
  }

  // 5. Per-entry mapping (one bad entry never discards the tick).
  const snapshots: TickerSnapshot[] = [];
  const latest: LatestEntryDto[] = [];
  let driftCount = 0;
  let scaleOverflowCount = 0;
  for (const rawEntry of raw) {
    const entry = safeParseTickerEntry(rawEntry);
    if (!entry) {
      driftCount += 1;
      continue;
    }
    const sym = map.get(entry.symbol);
    if (!sym) {
      driftCount += 1;
      continue;
    }
    let snapshot: TickerSnapshot;
    try {
      snapshot = mapEntry(entry, sym, bucketTs, serverMs);
    } catch (e) {
      // mapEntry only throws ScaleOverflow or DecimalParse; anything else counts as drift.
      if (e instanceof ScaleOverflowError) {
        scaleOverflowCount += 1;
        safeEvent(obs, 'scale_overflow', { symbol: entry.symbol }, { scale: sym.priceScale });
      } else {
        driftCount += 1;
      }
      continue;
    }
    const priorEntry = prior.get(sym.id);
    if (priorEntry !== undefined) {
      // Normalize the prior price to the current scale so a scale change is not a phantom jump.
      const priorNorm = rescaleMinor(priorEntry.last, priorEntry.scale, sym.priceScale);
      if (priorNorm > 0n && isSanityJump(snapshot.lastMinor, priorNorm)) {
        safeEvent(
          obs,
          'sanity_jump',
          { symbol: entry.symbol },
          { last: Number(snapshot.lastMinor), prior: Number(priorNorm) },
        );
      }
    }
    snapshots.push(snapshot);
    latest.push(toLatestEntry(entry.symbol, snapshot));
  }

  // 6. Atomic batch (N snapshots + terminal run row).
  const symbolsSeen = raw.length;
  const rowsInserted = snapshots.length;
  const rowsSkipped = symbolsSeen - rowsInserted;
  const status = rowsSkipped === 0 ? 'ok' : rowsInserted === 0 ? 'drift' : 'partial';
  const finishedMs = clock.now();
  const run: RunRecord = {
    bucketTs,
    kind: 'collect',
    status,
    startedMs,
    finishedMs,
    serverTsMs,
    symbolsSeen,
    rowsInserted,
    rowsSkipped,
    driftCount,
    scaleOverflowCount,
    rowsWritten: rowsInserted + 1,
    skewMs,
    httpStatus: 200,
    durationMs: finishedMs - startedMs,
    errorDetail: null,
  };

  let overlap = false;
  try {
    ({ overlap } = await store.commitCollect(snapshots, run));
  } catch (e) {
    await reportFailure(deps, base, 'store_error', null, errMessage(e));
    return;
  }
  // 7. Best-effort KV hot-cache (non-authoritative). Skip on overlap — D1 kept the first
  //    writer's snapshots, so caching this (second) fetch would break KV/D1 parity. A TTL
  //    bounds staleness so a stalled collector can't serve obsolete data indefinitely.
  if (overlap) {
    safeEvent(obs, 'overlap', { bucket: String(bucketTs) }, { count: 1 });
  } else {
    try {
      const payload: LatestDto = { bucketTs, writtenAtMs: finishedMs, entries: latest };
      await cache.put(LATEST_KEY, JSON.stringify(payload), Math.max(60, cadenceMinutes * 60 * 5));
    } catch {
      // hot cache is non-authoritative; never fail the tick on a KV write
    }
  }

  // 8. Best-effort run metric.
  safeRun(obs, run, overlap);
}
