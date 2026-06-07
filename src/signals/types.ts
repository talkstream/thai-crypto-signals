// Frozen signal wire shape (schemaVersion 2), pinned in src/signals/contract.ts.

/**
 * One mover: a symbol that FIRED the pct-change rule this bucket, carried with enough detail for the
 * delivery message to render a human line (direction, percent, price) without re-deriving anything.
 */
export interface Mover {
  /** Bitkub pair symbol, e.g. "TON_THB" (the display strips the quote → "TON"). */
  symbol: string;
  /** Signed move vs the prior bucket in integer basis points (e.g. +342 = +3.42%, -310 = -3.10%). */
  changeBp: number;
  /** Current price in integer minor units (e.g. satang for THB pairs). */
  priceMinor: number;
  /** Decimal scale to render `priceMinor` (e.g. 2 → divide by 100). */
  scale: number;
}

/**
 * One job per collect tick that produces a signal. `movers` are the symbols that fired the rule this
 * bucket — a tick with no movers produces no job. Batched into one message (cost note: keeps queue ops
 * tiny). schemaVersion 2 carries per-mover detail (was a bare `symbols: string[]` in v1).
 */
export interface SignalJob {
  bucketTs: number;
  movers: Mover[];
  producedAt: number;
  schemaVersion: 2;
}
