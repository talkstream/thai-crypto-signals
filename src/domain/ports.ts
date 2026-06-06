// Hexagon boundary. The domain/use-cases depend ONLY on these interfaces.
// Storage ports (SymbolStore, CollectStore, RollupStore) are added in the storage layer.

import type { SignalJob } from '../signals/types';
import type { MarketSymbol } from './types';

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
  getSymbols(): Promise<MarketSymbol[]>;
}

/** KV write port — never authoritative, never on the idempotency path. */
export interface CacheWriter {
  put(key: string, value: string): Promise<void>;
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
