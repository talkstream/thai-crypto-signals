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
  it('renders a plain-text heartbeat with the bucket time in ICT and the symbol count', () => {
    // ICT (Asia/Bangkok, no DST) of 1_700_000_040_000 == 2023-11-15 05:14, independently computed.
    expect(formatSignalMessage(job())).toBe('TCS collect 2023-11-15 05:14 ICT — 2 symbols');
  });

  it('reflects the symbol count and singularises "symbol" for exactly one', () => {
    expect(formatSignalMessage(job({ symbols: ['BTC_THB'] }))).toBe(
      'TCS collect 2023-11-15 05:14 ICT — 1 symbol',
    );
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
