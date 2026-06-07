import { describe, expect, it } from 'vitest';
import { parseWatchlist } from '../../src/signals/watchlist';

describe('parseWatchlist', () => {
  it('returns an empty set for undefined, empty, or whitespace input (= all symbols)', () => {
    expect(parseWatchlist(undefined).size).toBe(0);
    expect(parseWatchlist('').size).toBe(0);
    expect(parseWatchlist('   ').size).toBe(0);
  });

  it('parses a single symbol', () => {
    expect([...parseWatchlist('TON_THB')]).toEqual(['TON_THB']);
  });

  it('splits on commas, trims whitespace, and drops blanks', () => {
    expect([...parseWatchlist(' TON_THB , BTC_THB ,, ')].sort()).toEqual(['BTC_THB', 'TON_THB']);
  });

  it('deduplicates repeated symbols', () => {
    expect([...parseWatchlist('TON_THB,TON_THB')]).toEqual(['TON_THB']);
  });
});
