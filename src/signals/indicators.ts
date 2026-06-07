// DARK SEAM — phase-2 indicator signatures over bigint minor-unit series. The exact contract is
// frozen now; the implementations are deliberately unimplemented in v1. DORMANT: carved out of
// coverage, type-checked only (see src/signals/contract.ts).

/** Phase-2-only sentinel. Lives with the dormant scaffold, not in the live domain errors. */
class NotImplementedError extends Error {
  readonly tag = 'NotImplemented' as const;
  constructor(readonly phase: string) {
    super(`not implemented (${phase})`);
    this.name = 'NotImplementedError';
  }
}

export function percentChange(_series: bigint[]): number {
  throw new NotImplementedError('phase2');
}

export function thresholdCross(_series: bigint[], _threshold: bigint): boolean {
  throw new NotImplementedError('phase2');
}

export function smaCross(_series: bigint[], _period: number): boolean {
  throw new NotImplementedError('phase2');
}

export function nPeriodHighLow(_series: bigint[], _period: number): { high: bigint; low: bigint } {
  throw new NotImplementedError('phase2');
}
