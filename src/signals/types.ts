// DARK seam — phase-2 contract frozen now, zero delivery in v1.

/** One job per collect tick: all symbols batched (cost note: keeps queue ops tiny). */
export interface SignalJob {
  bucketTs: number;
  symbols: string[];
  producedAt: number;
  schemaVersion: 1;
}

/** Deterministic, evidence-honest rule primitives planned for phase 2. */
export type SignalRuleKind = 'pct_change' | 'threshold_cross' | 'sma_cross' | 'n_period_high_low';
