import { describe, expect, it } from 'vitest';
import { formatSignalMessage, lineRetryKey } from '../../src/signals/format';
import type { SignalJob } from '../../src/signals/types';

const job = (over: Partial<SignalJob> = {}): SignalJob => ({
  bucketTs: 1_700_000_040_000,
  symbols: ['BTC_THB', 'ETH_THB'],
  producedAt: 1,
  schemaVersion: 1,
  ...over,
});

describe('formatSignalMessage', () => {
  it('names the movers with the bucket time in ICT', () => {
    // ICT (Asia/Bangkok, no DST) of 1_700_000_040_000 == 2023-11-15 05:14, independently computed.
    expect(formatSignalMessage(job())).toBe(
      'TCS signal 2023-11-15 05:14 ICT — 2 symbols moved: BTC_THB, ETH_THB',
    );
  });

  it('singularises "symbol" for exactly one mover', () => {
    expect(formatSignalMessage(job({ symbols: ['BTC_THB'] }))).toBe(
      'TCS signal 2023-11-15 05:14 ICT — 1 symbol moved: BTC_THB',
    );
  });

  it('caps the listed movers with a "+N more" tail', () => {
    const symbols = Array.from({ length: 14 }, (_, i) => `S${i + 1}_THB`);
    const msg = formatSignalMessage(job({ symbols }));
    expect(msg).toContain('— 14 symbols moved: S1_THB, S2_THB,');
    expect(msg).toContain('S12_THB, +2 more');
    expect(msg).not.toContain('S13_THB'); // beyond the cap, only counted
  });
});

describe('lineRetryKey', () => {
  it('is a valid, deterministic UUID derived from the bucket', () => {
    const k = lineRetryKey(1_700_000_040_000);
    expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(lineRetryKey(1_700_000_040_000)).toBe(k); // deterministic across calls
  });

  it('differs per bucket', () => {
    expect(lineRetryKey(1_700_000_040_000)).not.toBe(lineRetryKey(1_700_000_160_000));
  });
});
