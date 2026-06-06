import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { INT64_MAX } from '../../src/config/constants';
import { DecimalParseError, ScaleOverflowError } from '../../src/domain/errors';
import {
  formatMinorToDecimal,
  parseDecimalToMinor,
  pctToBasisPoints,
} from '../../src/domain/price';

describe('parseDecimalToMinor', () => {
  it('parses integer + fractional at scale', () => {
    expect(parseDecimalToMinor('2017050.88', 2)).toBe(201705088n);
    expect(parseDecimalToMinor('0.000000010807', 13)).toBe(108070n);
  });

  it('pads short fractions and handles integers', () => {
    expect(parseDecimalToMinor('1', 2)).toBe(100n);
    expect(parseDecimalToMinor('0.1', 2)).toBe(10n);
    expect(parseDecimalToMinor('0', 2)).toBe(0n);
  });

  it('truncates fractions longer than scale toward zero', () => {
    expect(parseDecimalToMinor('1.239', 2)).toBe(123n);
  });

  it('handles negatives', () => {
    expect(parseDecimalToMinor('-0.94', 2)).toBe(-94n);
  });

  it('supports scale 0', () => {
    expect(parseDecimalToMinor('42', 0)).toBe(42n);
  });

  it('throws DecimalParseError on malformed input', () => {
    expect(() => parseDecimalToMinor('1.2.3', 2)).toThrow(DecimalParseError);
    expect(() => parseDecimalToMinor('abc', 2, 'BTC_THB')).toThrow(DecimalParseError);
    expect(() => parseDecimalToMinor('', 2)).toThrow(DecimalParseError);
  });

  it('throws ScaleOverflow when scaled value exceeds int64 (>=1000000 @ scale 13)', () => {
    expect(() => parseDecimalToMinor('1000000', 13, 'BABYDOGE_THB')).toThrow(ScaleOverflowError);
    // exact boundary: INT64_MAX itself must NOT throw
    expect(parseDecimalToMinor(INT64_MAX.toString(), 0)).toBe(INT64_MAX);
  });
});

describe('formatMinorToDecimal', () => {
  it('is the canonical inverse with trailing zeros trimmed', () => {
    expect(formatMinorToDecimal(201705088n, 2)).toBe('2017050.88');
    expect(formatMinorToDecimal(108070n, 13)).toBe('0.000000010807');
    expect(formatMinorToDecimal(100n, 2)).toBe('1');
    expect(formatMinorToDecimal(10n, 2)).toBe('0.1');
    expect(formatMinorToDecimal(0n, 2)).toBe('0');
  });

  it('handles negatives and scale <= 0', () => {
    expect(formatMinorToDecimal(-94n, 2)).toBe('-0.94');
    expect(formatMinorToDecimal(42n, 0)).toBe('42');
  });
});

describe('pctToBasisPoints', () => {
  it('converts percent to integer basis points', () => {
    expect(pctToBasisPoints('-0.94')).toBe(-94);
    expect(pctToBasisPoints('0.5')).toBe(50);
    expect(pctToBasisPoints('0')).toBe(0);
  });
});

describe('round-trip property (bigint -> string -> bigint is exact, scale 1..13)', () => {
  it('holds over the bounded int64 domain', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: INT64_MAX }),
        fc.integer({ min: 1, max: 13 }),
        (m, s) => {
          const round = parseDecimalToMinor(formatMinorToDecimal(m, s), s);
          return round === m;
        },
      ),
      { seed: 42, numRuns: 2000 },
    );
  });
});
