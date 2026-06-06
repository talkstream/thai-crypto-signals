import { type LatestDto, toLatestEntry } from '../../domain/dto';
import { SymbolNotInCatalogError } from '../../domain/errors';
import { formatMinorToDecimal } from '../../domain/price';

export interface SymbolDto {
  id: number;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  priceScale: number;
  status: string;
}

export interface HealthDto {
  ok: boolean;
  nowMs: number;
  lastCollectBucketTs: number | null;
  lastCollectStatus: string | null;
  lastObservedMs: number | null;
  symbolCount: number;
  recentDrift: number;
  recentScaleOverflow: number;
}

export interface HistoryPoint {
  bucketTs: number;
  observedMs: number;
  last: string;
  bid: string | null;
  ask: string | null;
  pctChangeBp: number;
}
export interface HistoryDto {
  symbol: string;
  points: HistoryPoint[];
}

export interface RollupPoint {
  ts: number;
  open: string;
  high: string;
  low: string;
  close: string;
  sampleCount: number;
  finalized: boolean;
}
export interface RollupsDto {
  symbol: string;
  interval: '1h' | '1d';
  points: RollupPoint[];
}

export interface ReadStore {
  health(nowMs: number, freshMs: number): Promise<HealthDto>;
  listSymbols(): Promise<SymbolDto[]>;
  latest(): Promise<LatestDto>;
  history(symbol: string, fromMs: number, toMs: number, limit: number): Promise<HistoryDto>;
  rollups(symbol: string, interval: '1h' | '1d', limit: number): Promise<RollupsDto>;
}

export class D1ReadStore implements ReadStore {
  constructor(private readonly db: D1Database) {}

  private async assertSymbolExists(symbol: string): Promise<void> {
    const row = await this.db
      .prepare('SELECT 1 AS x FROM symbols WHERE symbol = ?')
      .bind(symbol)
      .first<{ x: number }>();
    if (!row) throw new SymbolNotInCatalogError(symbol);
  }

  async health(nowMs: number, freshMs: number): Promise<HealthDto> {
    const lastRun = await this.db
      .prepare(
        "SELECT bucket_ts, status, drift_count, scale_overflow_count FROM collection_runs WHERE kind = 'collect' ORDER BY bucket_ts DESC LIMIT 1",
      )
      .first<{
        bucket_ts: number;
        status: string;
        drift_count: number;
        scale_overflow_count: number;
      }>();
    /* istanbul ignore next -- MAX() always returns exactly one row */
    const observed = (await this.db
      .prepare('SELECT MAX(observed_ms) AS m FROM ticker_snapshots')
      .first<{ m: number | null }>()) ?? { m: null };
    /* istanbul ignore next -- COUNT() always returns exactly one row */
    const counts = (await this.db
      .prepare('SELECT COUNT(*) AS n FROM symbols')
      .first<{ n: number }>()) ?? { n: 0 };
    const lastObservedMs = observed.m;
    return {
      ok:
        lastObservedMs !== null && nowMs - lastObservedMs >= 0 && nowMs - lastObservedMs <= freshMs,
      nowMs,
      lastCollectBucketTs: lastRun?.bucket_ts ?? null,
      lastCollectStatus: lastRun?.status ?? null,
      lastObservedMs,
      symbolCount: counts.n,
      recentDrift: lastRun?.drift_count ?? 0,
      recentScaleOverflow: lastRun?.scale_overflow_count ?? 0,
    };
  }

  async listSymbols(): Promise<SymbolDto[]> {
    const { results } = await this.db
      .prepare(
        'SELECT id, symbol, base_asset, quote_asset, price_scale, status FROM symbols ORDER BY symbol',
      )
      .all<{
        id: number;
        symbol: string;
        base_asset: string;
        quote_asset: string;
        price_scale: number;
        status: string;
      }>();
    return results.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      baseAsset: r.base_asset,
      quoteAsset: r.quote_asset,
      priceScale: r.price_scale,
      status: r.status,
    }));
  }

  async latest(): Promise<LatestDto> {
    /* istanbul ignore next -- MAX() always returns exactly one row */
    const maxRow = (await this.db
      .prepare('SELECT MAX(bucket_ts) AS b FROM ticker_snapshots')
      .first<{ b: number | null }>()) ?? { b: null };
    const bucketTs = maxRow.b ?? 0;
    const { results } = await this.db
      .prepare(
        `SELECT s.symbol AS symbol, t.observed_ms, t.last_minor, t.bid_minor, t.ask_minor,
                t.price_scale_used, t.pct_change_bp
         FROM ticker_snapshots t JOIN symbols s ON s.id = t.symbol_id
         WHERE t.bucket_ts = ?`,
      )
      .bind(bucketTs)
      .all<{
        symbol: string;
        observed_ms: number;
        last_minor: number;
        bid_minor: number | null;
        ask_minor: number | null;
        price_scale_used: number;
        pct_change_bp: number;
      }>();
    const entries = results.map((r) =>
      toLatestEntry(r.symbol, {
        lastMinor: BigInt(r.last_minor),
        bidMinor: r.bid_minor === null ? null : BigInt(r.bid_minor),
        askMinor: r.ask_minor === null ? null : BigInt(r.ask_minor),
        priceScaleUsed: r.price_scale_used,
        pctChangeBp: r.pct_change_bp,
        observedMs: r.observed_ms,
      }),
    );
    return { bucketTs, writtenAtMs: 0, entries };
  }

  async history(symbol: string, fromMs: number, toMs: number, limit: number): Promise<HistoryDto> {
    await this.assertSymbolExists(symbol);
    const { results } = await this.db
      .prepare(
        `SELECT t.bucket_ts, t.observed_ms, t.last_minor, t.bid_minor, t.ask_minor,
                t.price_scale_used, t.pct_change_bp
         FROM ticker_snapshots t JOIN symbols s ON s.id = t.symbol_id
         WHERE s.symbol = ? AND t.bucket_ts >= ? AND t.bucket_ts <= ?
         ORDER BY t.bucket_ts DESC LIMIT ?`,
      )
      .bind(symbol, fromMs, toMs, limit)
      .all<{
        bucket_ts: number;
        observed_ms: number;
        last_minor: number;
        bid_minor: number | null;
        ask_minor: number | null;
        price_scale_used: number;
        pct_change_bp: number;
      }>();
    // Format each row with the scale it was stored at (self-describing), not the current
    // catalog scale — so a later exchange scale change never shifts old prices.
    const points = results.map((r) => ({
      bucketTs: r.bucket_ts,
      observedMs: r.observed_ms,
      last: formatMinorToDecimal(BigInt(r.last_minor), r.price_scale_used),
      bid:
        r.bid_minor === null ? null : formatMinorToDecimal(BigInt(r.bid_minor), r.price_scale_used),
      ask:
        r.ask_minor === null ? null : formatMinorToDecimal(BigInt(r.ask_minor), r.price_scale_used),
      pctChangeBp: r.pct_change_bp,
    }));
    return { symbol, points };
  }

  async rollups(symbol: string, interval: '1h' | '1d', limit: number): Promise<RollupsDto> {
    await this.assertSymbolExists(symbol);
    const table = interval === '1h' ? 'rollups_1h' : 'rollups_1d';
    const tsCol = interval === '1h' ? 'hour_ts' : 'day_ts';
    const { results } = await this.db
      .prepare(
        `SELECT r.${tsCol} AS ts, r.open_minor, r.high_minor, r.low_minor, r.close_minor,
                r.price_scale_used, r.sample_count, r.finalized
         FROM ${table} r JOIN symbols s ON s.id = r.symbol_id
         WHERE s.symbol = ? ORDER BY ts DESC LIMIT ?`,
      )
      .bind(symbol, limit)
      .all<{
        ts: number;
        open_minor: number;
        high_minor: number;
        low_minor: number;
        close_minor: number;
        price_scale_used: number;
        sample_count: number;
        finalized: number;
      }>();
    const points = results.map((r) => ({
      ts: r.ts,
      open: formatMinorToDecimal(BigInt(r.open_minor), r.price_scale_used),
      high: formatMinorToDecimal(BigInt(r.high_minor), r.price_scale_used),
      low: formatMinorToDecimal(BigInt(r.low_minor), r.price_scale_used),
      close: formatMinorToDecimal(BigInt(r.close_minor), r.price_scale_used),
      sampleCount: r.sample_count,
      finalized: r.finalized === 1,
    }));
    return { symbol, interval, points };
  }
}
