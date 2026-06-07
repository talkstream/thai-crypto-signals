import { describe, expect, it } from 'vitest';
import { pctChangeFires, percentChangeBp } from '../../src/signals/indicators';

describe('percentChangeBp (per-bucket move in basis points, integer minor units)', () => {
  it('computes a signed percent move in basis points', () => {
    expect(percentChangeBp(103n, 100n)).toBe(300); // +3.00%
    expect(percentChangeBp(97n, 100n)).toBe(-300); // -3.00%
    expect(percentChangeBp(100n, 100n)).toBe(0); // flat
  });

  it('truncates toward zero (matches the codebase bp convention)', () => {
    // (200-3)*10000/3 = 1_970_000/3 = 656666.66… -> 656666
    expect(percentChangeBp(200n, 3n)).toBe(656666);
  });

  it('returns 0 when there is no positive baseline', () => {
    expect(percentChangeBp(100n, 0n)).toBe(0);
    expect(percentChangeBp(100n, -5n)).toBe(0);
  });
});

describe('pctChangeFires (the pct-change signal rule)', () => {
  it('fires when the absolute move meets the threshold (either direction)', () => {
    expect(pctChangeFires(103n, 100n, 300)).toBe(true); // +3% >= 3%
    expect(pctChangeFires(97n, 100n, 300)).toBe(true); // -3% (|.| >= 3%)
  });

  it('does not fire below the threshold or without a baseline', () => {
    expect(pctChangeFires(102n, 100n, 300)).toBe(false); // +2% < 3%
    expect(pctChangeFires(100n, 100n, 300)).toBe(false); // flat
    expect(pctChangeFires(100n, 0n, 300)).toBe(false); // no baseline
  });
});
