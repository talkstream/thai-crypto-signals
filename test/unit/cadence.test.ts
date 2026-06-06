import { describe, expect, it } from 'vitest';
import { bucketTsFor, cronExprFor, isAllowedCadence } from '../../src/config/cadence';

describe('isAllowedCadence', () => {
  it('accepts 60-divisors and rejects others', () => {
    for (const ok of [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30])
      expect(isAllowedCadence(ok)).toBe(true);
    for (const bad of [0, 7, 8, 9, 11, 13, 14, 60]) expect(isAllowedCadence(bad)).toBe(false);
  });
});

describe('cronExprFor', () => {
  it('emits */N for N>1 and * * * * * for 1', () => {
    expect(cronExprFor(1)).toBe('* * * * *');
    expect(cronExprFor(2)).toBe('*/2 * * * *');
    expect(cronExprFor(15)).toBe('*/15 * * * *');
  });

  it('throws on non-60-divisor cadence', () => {
    expect(() => cronExprFor(7)).toThrow(/not a 60-divisor/);
  });
});

describe('bucketTsFor', () => {
  it('floors to the cadence bucket', () => {
    const cadence = 2;
    const span = 60_000 * cadence;
    // 16:57:30 -> floor to 16:56:00 for a 2-min bucket
    const t = Date.UTC(2026, 5, 6, 16, 57, 30);
    expect(bucketTsFor(t, cadence)).toBe(Math.floor(t / span) * span);
  });

  it('for a 60-divisor, consecutive buckets never collide across the hour boundary', () => {
    const cadence = 2;
    const before = bucketTsFor(Date.UTC(2026, 5, 6, 16, 58, 10), cadence);
    const after = bucketTsFor(Date.UTC(2026, 5, 6, 17, 0, 10), cadence);
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBe(60_000 * cadence);
  });
});
