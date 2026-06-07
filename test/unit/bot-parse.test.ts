import { describe, expect, it } from 'vitest';
import {
  type Callback,
  decodeCallback,
  normalizeSymbol,
  parseThresholdPercent,
} from '../../src/signals/bot/parse';

describe('parseThresholdPercent', () => {
  it('parses a whole percent into basis points', () => {
    expect(parseThresholdPercent('3')).toBe(300);
    expect(parseThresholdPercent(' 10 ')).toBe(1000);
    expect(parseThresholdPercent('1')).toBe(100);
    expect(parseThresholdPercent('100')).toBe(10_000);
  });

  it('rejects non-positive, fractional, out-of-range, or non-numeric input', () => {
    for (const bad of ['0', '-1', '3.5', 'abc', '', '101', '999', ' ']) {
      expect(parseThresholdPercent(bad)).toBeNull();
    }
  });
});

describe('normalizeSymbol', () => {
  it('uppercases and trims', () => {
    expect(normalizeSymbol(' ton_thb ')).toBe('TON_THB');
    expect(normalizeSymbol('ada')).toBe('ADA');
  });
});

describe('decodeCallback', () => {
  it('decodes each exact + prefixed action', () => {
    const cases: [string, Callback][] = [
      ['m', { kind: 'main' }],
      ['t', { kind: 'thresholdMenu' }],
      ['t:x', { kind: 'customThreshold' }],
      ['t:300', { kind: 'setThreshold', bp: 300 }],
      ['a', { kind: 'addMenu' }],
      ['a:x', { kind: 'customAdd' }],
      ['a:TON_THB', { kind: 'addSymbol', symbol: 'TON_THB' }],
      ['r', { kind: 'removeMenu' }],
      ['r:TON_THB', { kind: 'removeSymbol', symbol: 'TON_THB' }],
    ];
    for (const [data, expected] of cases) expect(decodeCallback(data)).toEqual(expected);
  });

  it('rejects off-safelist thresholds and garbage', () => {
    for (const bad of ['t:200', 't:abc', 'a:', 'r:', 'x', '', 'z:1']) {
      expect(decodeCallback(bad)).toBeNull();
    }
  });

  it('keeps every authored callback_data within Telegram 64-byte limit', () => {
    const enc = (s: string) => new TextEncoder().encode(s).length;
    for (const fixed of ['m', 't', 't:x', 't:1000', 'a', 'a:x', 'r']) {
      expect(enc(fixed)).toBeLessThanOrEqual(64);
    }
    // the a:/r: prefix adds 2 bytes; a 30-char symbol (far beyond any Bitkub pair) still fits
    expect(enc(`a:${'A'.repeat(30)}`)).toBeLessThanOrEqual(64);
    expect(enc(`r:${'A'.repeat(30)}`)).toBeLessThanOrEqual(64);
  });
});
