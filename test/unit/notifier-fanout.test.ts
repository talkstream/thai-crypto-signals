import { describe, expect, it } from 'vitest';
import type { DeliveryResult, Notifier } from '../../src/signals/notifier';
import { FanOutNotifier } from '../../src/signals/notifiers/fan-out';
import type { SignalJob } from '../../src/signals/types';

const JOB: SignalJob = {
  bucketTs: 1,
  movers: [{ symbol: 'BTC_THB', changeBp: 342, priceMinor: 100, scale: 2 }],
  producedAt: 2,
  schemaVersion: 2,
};

// Plain stub channels (DI, not vi.mock): each returns a fixed per-channel DeliveryResult so we test
// the FanOut's summation + max-retryAfter logic in isolation.
const base: DeliveryResult = {
  delivered: 0,
  nonIdempotentDelivered: 0,
  skipped: 0,
  permanentFailures: 0,
  transientFailures: 0,
  ambiguousFailures: 0,
};
const stub = (over: Partial<DeliveryResult>): Notifier => ({
  deliver: async () => ({ ...base, ...over }),
});

describe('FanOutNotifier', () => {
  it('returns all-zero for zero channels', async () => {
    expect(await new FanOutNotifier([]).deliver(JOB)).toEqual(base);
  });

  it('sums delivered across all channels', async () => {
    const r = await new FanOutNotifier([
      stub({ delivered: 1 }),
      stub({ delivered: 1 }),
      stub({ delivered: 1 }),
    ]).deliver(JOB);
    expect(r.delivered).toBe(3);
    expect(r.transientFailures).toBe(0);
  });

  it('counts a skipped (unconfigured) channel separately from delivered', async () => {
    const r = await new FanOutNotifier([
      stub({ delivered: 1 }),
      stub({ skipped: 1 }),
      stub({ delivered: 1 }),
    ]).deliver(JOB);
    expect(r.delivered).toBe(2);
    expect(r.skipped).toBe(1);
  });

  it('flags transient when any channel is transient and takes the MAX retryAfterSec', async () => {
    // Order exercises every max-merge branch: undefined→5, 5→(undefined kept), 5→20.
    const r = await new FanOutNotifier([
      stub({ transientFailures: 1, retryAfterSec: 5 }),
      stub({ delivered: 1 }),
      stub({ transientFailures: 1, retryAfterSec: 20 }),
    ]).deliver(JOB);
    expect(r.transientFailures).toBe(2);
    expect(r.delivered).toBe(1);
    expect(r.retryAfterSec).toBe(20);
  });

  it('sums permanent + delivered with no transient (no retry)', async () => {
    const r = await new FanOutNotifier([
      stub({ delivered: 1 }),
      stub({ permanentFailures: 1 }),
    ]).deliver(JOB);
    expect(r.delivered).toBe(1);
    expect(r.permanentFailures).toBe(1);
    expect(r.transientFailures).toBe(0);
    expect(r.retryAfterSec).toBeUndefined();
  });

  it('sums ambiguous failures (e.g. a Telegram transport error) alongside delivered', async () => {
    const r = await new FanOutNotifier([
      stub({ delivered: 1 }),
      stub({ ambiguousFailures: 1 }),
    ]).deliver(JOB);
    expect(r.delivered).toBe(1);
    expect(r.ambiguousFailures).toBe(1);
    expect(r.transientFailures).toBe(0);
  });

  it('treats a throwing channel as ambiguous (allSettled) without discarding the others', async () => {
    const throwing: Notifier = {
      deliver: async () => {
        throw new Error('boom');
      },
    };
    const r = await new FanOutNotifier([stub({ delivered: 1 }), throwing]).deliver(JOB);
    expect(r.delivered).toBe(1); // the completed channel's result is preserved
    expect(r.ambiguousFailures).toBe(1); // the throw became an ambiguous failure (no retry)
  });
});
