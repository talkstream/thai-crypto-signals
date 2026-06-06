// Hexagon boundary. The domain/use-cases depend ONLY on these interfaces.
// Storage ports (SymbolStore, CollectStore, RollupStore) are added in the storage layer.

import type { SignalJob } from '../signals/types';
import type { CatalogEntry, RunRecord, SymbolMap, TickerSnapshot } from './types';

/** Injected time source — no wall-clock anywhere else (CI-guarded). */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** Injected randomness — for retry jitter; deterministic in tests. */
export interface Rng {
  /** uniform in [0, 1) */
  nextUnit(): number;
}

/** The ONE external HTTP boundary (Bitkub). Stubbed in tests via globalThis.fetch. */
export interface MarketDataSource {
  getServerTime(): Promise<number>;
  /** Envelope-validated as an array; entries stay raw for per-entry validation downstream. */
  getTicker(): Promise<unknown[]>;
  getSymbols(): Promise<CatalogEntry[]>;
}

/** KV write port — never authoritative, never on the idempotency path. */
export interface CacheWriter {
  put(key: string, value: string, ttlSeconds?: number): Promise<void>;
}

export type ObsBlobs = Record<string, string>;
export type ObsDoubles = Record<string, number>;

/** Analytics Engine port — tolerates an undefined binding locally. */
export interface ObservabilitySink {
  writeRun(blobs: ObsBlobs, doubles: ObsDoubles): void;
  writeEvent(kind: string, blobs: ObsBlobs, doubles: ObsDoubles): void;
}

/** Queue producer port (DARK). Prod wraps env.SIGNALS_QUEUE.send; tests use an in-memory fake. */
export interface SignalDispatcher {
  enqueue(job: SignalJob): Promise<void>;
}

/** Symbol catalog persistence. The map carries the permanent surrogate id per symbol. */
export interface SymbolStore {
  loadMap(): Promise<SymbolMap>;
  upsertMany(entries: CatalogEntry[], nowMs: number): Promise<void>;
}

/** The atomic collect path: one batch commits N snapshots + the terminal run row. */
export interface CollectStore {
  /** Last price (+ its scale) per symbol_id at the immediately-preceding bucket, for the 10x check. */
  priorLastBySymbol(bucketTs: number): Promise<Map<number, { last: bigint; scale: number }>>;
  /** Single atomic batch; `overlap` is true when the run row already existed (duplicate fire). */
  commitCollect(snapshots: TickerSnapshot[], run: RunRecord): Promise<{ overlap: boolean }>;
  /** Best-effort terminal run row when the collect batch threw before commit. */
  failRun(run: RunRecord): Promise<void>;
}
