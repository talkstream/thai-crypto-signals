// Signal rule evaluation over bigint minor-unit prices. Live as of the indicators sub-phase: the
// pct-change rule gates signal emission in the collect path (see src/collector/collect.ts).

/**
 * Per-bucket price move in integer basis points (percent × 100), computed entirely on bigint minor
 * units and truncated toward zero — matching the codebase's basis-points convention (see
 * `pctToBasisPoints`). Returns 0 when there is no positive baseline (defensive for direct callers;
 * the collect path already guards `priorNorm > 0n` upstream).
 */
export function percentChangeBp(currentMinor: bigint, previousMinor: bigint): number {
  if (previousMinor <= 0n) return 0;
  return Number(((currentMinor - previousMinor) * 10000n) / previousMinor);
}

/**
 * The pct-change signal rule: did this symbol move at least `thresholdBp` basis points (in either
 * direction) versus the immediately-preceding bucket? This is what turns a per-tick collection
 * heartbeat into an actual price-move signal.
 */
export function pctChangeFires(
  currentMinor: bigint,
  previousMinor: bigint,
  thresholdBp: number,
): boolean {
  return Math.abs(percentChangeBp(currentMinor, previousMinor)) >= thresholdBp;
}
