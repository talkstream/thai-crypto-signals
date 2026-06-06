import { describe, expect, it } from 'vitest';
import symbolsReal from '../../src/adapters/bitkub/cassettes/symbols.json';
import tickerDrift from '../../src/adapters/bitkub/cassettes/synthetic/ticker-drift.json';
import tickerMalformed from '../../src/adapters/bitkub/cassettes/synthetic/ticker-malformed.json';
import tickerSparse from '../../src/adapters/bitkub/cassettes/synthetic/ticker-sparse.json';
import tickerReal from '../../src/adapters/bitkub/cassettes/ticker.json';
import {
  parseServerTime,
  parseSymbols,
  parseTickerEnvelope,
  safeParseTickerEntry,
} from '../../src/adapters/bitkub/schemas';
import { PayloadValidationError } from '../../src/domain/errors';

describe('ticker envelope + per-entry (recorded real payload)', () => {
  it('accepts the recorded ticker array and every real entry parses', () => {
    const entries = parseTickerEnvelope(tickerReal as unknown);
    expect(entries.length).toBe(441);
    const parsed = entries.map(safeParseTickerEntry);
    expect(parsed.every((e) => e !== null)).toBe(true);
  });

  it('keeps one-sided books at the schema level (zero bid is still a valid string)', () => {
    const oneSided = (tickerReal as Array<{ highest_bid: string }>).find(
      (e) => e.highest_bid === '0' || e.highest_bid === '0.00' || e.highest_bid === '',
    );
    expect(oneSided).toBeDefined();
    expect(safeParseTickerEntry(oneSided)).not.toBeNull();
  });
});

describe('ticker per-entry tolerance (synthetic sparse)', () => {
  it('parses good entries and rejects the malformed one without discarding the array', () => {
    const entries = parseTickerEnvelope(tickerSparse as unknown);
    expect(entries.length).toBe(3);
    expect(safeParseTickerEntry(entries[0])).not.toBeNull(); // BTC_THB
    expect(safeParseTickerEntry(entries[1])).not.toBeNull(); // ALPACA_THB (zero bid/ask)
    expect(safeParseTickerEntry(entries[2])).toBeNull(); // BADCOIN_THB (last is a number)
  });
});

describe('ticker envelope violation (synthetic malformed)', () => {
  it('throws PayloadValidationError when the payload is not an array', () => {
    expect(() => parseTickerEnvelope(tickerMalformed as unknown)).toThrow(PayloadValidationError);
  });
});

describe('drift cassette parses at the schema level (catalog drift is a collector concern)', () => {
  it('a well-formed entry for an unlisted symbol still passes the schema', () => {
    const entries = parseTickerEnvelope(tickerDrift as unknown);
    expect(safeParseTickerEntry(entries[0])).not.toBeNull();
  });
});

describe('symbols (recorded real payload)', () => {
  it('parses 454 entries and surfaces price_scale up to 13', () => {
    const catalog = parseSymbols(symbolsReal as unknown);
    expect(catalog.length).toBe(454);
    const baby = catalog.find((s) => s.symbol === 'BABYDOGE_THB');
    expect(baby?.priceScale).toBe(13);
    expect(catalog.every((s) => s.quoteAsset.length > 0)).toBe(true);
  });

  it('throws on a malformed symbols envelope', () => {
    expect(() => parseSymbols({ nope: true } as unknown)).toThrow(PayloadValidationError);
  });
});

describe('servertime', () => {
  it('coerces a numeric string to an int', () => {
    expect(parseServerTime('1780745575377')).toBe(1780745575377);
    expect(parseServerTime(1780745575377)).toBe(1780745575377);
  });

  it('throws on a non-numeric body', () => {
    expect(() => parseServerTime('not-a-number')).toThrow(PayloadValidationError);
  });
});
