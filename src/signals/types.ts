// Frozen signal wire shape (schemaVersion 1), pinned in src/signals/contract.ts.

/**
 * One job per collect tick that produces a signal. `symbols` are the symbols that FIRED the rule this
 * bucket (the movers) — a tick with no movers produces no job. Batched into one message (cost note:
 * keeps queue ops tiny).
 */
export interface SignalJob {
  bucketTs: number;
  symbols: string[];
  producedAt: number;
  schemaVersion: 1;
}
