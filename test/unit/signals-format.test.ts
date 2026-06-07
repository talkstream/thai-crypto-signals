import { describe, expect, it } from 'vitest';
import { formatSignalMessage, lineRetryKey } from '../../src/signals/format';
import type { Mover, SignalJob } from '../../src/signals/types';

const BUCKET = 1_700_000_040_000; // ICT (Asia/Bangkok, no DST) == 2023-11-15 05:14, independently computed
const HEADER = 'TCS · 2023-11-15 05:14 ICT';
const mover = (over: Partial<Mover> = {}): Mover => ({
  symbol: 'TON_THB',
  changeBp: 342,
  priceMinor: 10_000,
  scale: 2,
  ...over,
});
const job = (movers: Mover[]): SignalJob => ({
  bucketTs: BUCKET,
  movers,
  producedAt: 1,
  schemaVersion: 2,
});

describe('formatSignalMessage', () => {
  it('renders an up mover with a green marker, base symbol, signed %, and ฿ price', () => {
    expect(formatSignalMessage(job([mover()]))).toBe(`${HEADER}\n🟢 TON +3.42%  ฿100.00`);
  });

  it('renders a down mover with a red marker and a negative %', () => {
    expect(formatSignalMessage(job([mover({ changeBp: -310, priceMinor: 9_680 })]))).toBe(
      `${HEADER}\n🔴 TON -3.10%  ฿96.80`,
    );
  });

  it('strips the quote and renders the price at the pair scale', () => {
    expect(
      formatSignalMessage(
        job([mover({ symbol: 'BTC_THB', changeBp: 500, priceMinor: 2_400_000, scale: 0 })]),
      ),
    ).toBe(`${HEADER}\n🟢 BTC +5.00%  ฿2400000`);
  });

  it('lists one line per mover', () => {
    const msg = formatSignalMessage(
      job([mover(), mover({ symbol: 'ETH_THB', changeBp: -400, priceMinor: 8_000_000, scale: 2 })]),
    );
    expect(msg).toBe(`${HEADER}\n🟢 TON +3.42%  ฿100.00\n🔴 ETH -4.00%  ฿80000.00`);
  });

  it('caps the listed movers with a "+N more" tail', () => {
    const movers = Array.from({ length: 14 }, (_, i) => mover({ symbol: `S${i + 1}_THB` }));
    const msg = formatSignalMessage(job(movers));
    expect(msg).toContain('🟢 S1 +3.42%');
    expect(msg).toContain('🟢 S12 +3.42%');
    expect(msg).toContain('… +2 more');
    expect(msg).not.toContain('S13'); // beyond the cap, only counted
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
