// Pure domain types. Prices are bigint minor units; never floats.

export interface MarketSymbol {
  id: number;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  priceScale: number;
  quoteScale: number;
  marketSegment: string;
  status: string;
}

export type SymbolMap = ReadonlyMap<string, MarketSymbol>;

export interface TickerSnapshot {
  symbolId: number;
  bucketTs: number;
  observedMs: number;
  lastMinor: bigint;
  highMinor: bigint;
  lowMinor: bigint;
  bidMinor: bigint | null;
  askMinor: bigint | null;
  priceScaleUsed: number;
  baseVolume: string;
  quoteVolume: string;
  pctChangeBp: number;
}

export type RunKind = 'collect' | 'rollup' | 'catalog' | 'prune' | 'reap' | 'runs_prune';

export type CollectStatus =
  | 'ok'
  | 'partial'
  | 'rate_limited'
  | 'http_error'
  | 'timeout'
  | 'drift'
  | 'fetch_failed';

export interface RunRecord {
  bucketTs: number;
  kind: RunKind;
  status: string;
  startedMs: number;
  finishedMs: number | null;
  serverTsMs: number | null;
  symbolsSeen: number;
  rowsInserted: number;
  rowsSkipped: number;
  driftCount: number;
  scaleOverflowCount: number;
  rowsWritten: number;
  skewMs: number | null;
  httpStatus: number | null;
  durationMs: number | null;
  errorDetail: string | null;
}
