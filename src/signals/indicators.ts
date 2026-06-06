// DARK SEAM — phase-2 indicator signatures over bigint minor-unit series. The exact contract
// is frozen now; the implementations are deliberately unimplemented in v1.

import { NotImplementedError } from '../domain/errors';

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
