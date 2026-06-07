import { describe, expect, it } from 'vitest';
import { type AckableMessage, clampDelay, consumeSignals } from '../../src/signals/consumer';
import type { DeliveryResult, Notifier } from '../../src/signals/notifier';
import { InMemoryObservabilitySink } from '../helpers/fakes';

// The consumer is live production wiring (the worker's queue() handler calls it). No mock, no cast:
// AckableMessage and Notifier are plain interfaces, so the test builds plain objects. Notifier stubs
// return a fixed DeliveryResult (DI, not vi.mock) so we drive the ack/retry decision deterministically.
const RESULT: DeliveryResult = {
  delivered: 0,
  skipped: 0,
  permanentFailures: 0,
  transientFailures: 0,
  ambiguousFailures: 0,
};
const notifierReturning = (over: Partial<DeliveryResult>): Notifier => ({
  deliver: async () => ({ ...RESULT, ...over }),
});
const throwingNotifier: Notifier = {
  deliver: async () => {
    throw new Error('deliver blew up');
  },
};

const VALID = { bucketTs: 1, symbols: ['BTC_THB'], producedAt: 2, schemaVersion: 1 };

interface Recorder {
  message: AckableMessage;
  acked: number;
  retried: number;
  retryOpts: Array<{ delaySeconds?: number } | undefined>;
}
function recorder(body: unknown, attempts = 1): Recorder {
  const rec: Recorder = { acked: 0, retried: 0, retryOpts: [], message: {} as AckableMessage };
  rec.message = {
    body,
    attempts,
    ack: () => {
      rec.acked += 1;
    },
    retry: (o?: { delaySeconds?: number }) => {
      rec.retried += 1;
      rec.retryOpts.push(o);
    },
  };
  return rec;
}

describe('consumeSignals (deliver -> ack/retry)', () => {
  it('acks and emits signal_delivered when there are no transient failures', async () => {
    const obs = new InMemoryObservabilitySink();
    const m = recorder(VALID);
    await consumeSignals([m.message], notifierReturning({ delivered: 1 }), obs, true);

    expect(m.acked).toBe(1);
    expect(m.retried).toBe(0);
    expect(obs.events.some((e) => e.kind === 'signal_delivered')).toBe(true);
  });

  it('retries (no ack) with the clamped delay when a channel is transiently failing', async () => {
    const obs = new InMemoryObservabilitySink();
    const m = recorder(VALID);
    await consumeSignals(
      [m.message],
      notifierReturning({ transientFailures: 1, retryAfterSec: 30 }),
      obs,
      true,
    );

    expect(m.acked).toBe(0);
    expect(m.retried).toBe(1);
    expect(m.retryOpts[0]).toEqual({ delaySeconds: 30 });
    expect(obs.events.some((e) => e.kind === 'signal_retry')).toBe(true);
  });

  it('retries with NO options (platform default) when no retry hint is given', async () => {
    const obs = new InMemoryObservabilitySink();
    const m = recorder(VALID);
    await consumeSignals([m.message], notifierReturning({ transientFailures: 1 }), obs, true);

    expect(m.retried).toBe(1);
    expect(m.retryOpts[0]).toBeUndefined();
  });

  it('acks a partial result (a channel delivered + one transient) WITHOUT retrying — no duplicate', async () => {
    const obs = new InMemoryObservabilitySink();
    const m = recorder(VALID);
    await consumeSignals(
      [m.message],
      notifierReturning({ delivered: 1, transientFailures: 1, retryAfterSec: 30 }),
      obs,
      true,
    );

    expect(m.acked).toBe(1); // acked: retrying would re-send the already-delivered channel
    expect(m.retried).toBe(0);
    expect(obs.events.some((e) => e.kind === 'signal_partial')).toBe(true);
  });

  it('acks and flags an invalid body without ever calling the notifier', async () => {
    const obs = new InMemoryObservabilitySink();
    const m = recorder({ not: 'a job' });
    let delivered = false;
    await consumeSignals(
      [m.message],
      {
        deliver: async () => {
          delivered = true;
          return RESULT;
        },
      },
      obs,
      true,
    );

    expect(m.acked).toBe(1);
    expect(m.retried).toBe(0);
    expect(delivered).toBe(false);
    expect(obs.events.filter((e) => e.kind === 'signal_invalid').length).toBe(1);
  });

  it('acks (drops) a job with a non-finite bucketTs as invalid', async () => {
    const obs = new InMemoryObservabilitySink();
    const m = recorder({ ...VALID, bucketTs: Number.POSITIVE_INFINITY });
    await consumeSignals([m.message], notifierReturning({ delivered: 1 }), obs, true);

    expect(m.acked).toBe(1);
    expect(obs.events.some((e) => e.kind === 'signal_invalid')).toBe(true);
  });

  it('acks (drops) a finite but out-of-Date-range epoch timestamp as invalid', async () => {
    const obs = new InMemoryObservabilitySink();
    const m = recorder({ ...VALID, bucketTs: 8_640_000_000_000_001 }); // > JS Date max -> Intl throws
    await consumeSignals([m.message], notifierReturning({ delivered: 1 }), obs, true);

    expect(m.acked).toBe(1);
    expect(obs.events.some((e) => e.kind === 'signal_invalid')).toBe(true);
  });

  it('acks (drops) an oversized job rather than 4xx-looping a channel', async () => {
    const obs = new InMemoryObservabilitySink();
    const huge = { ...VALID, symbols: Array.from({ length: 2001 }, (_, i) => `S${i}_THB`) };
    const m = recorder(huge);
    await consumeSignals([m.message], notifierReturning({ delivered: 1 }), obs, true);

    expect(m.acked).toBe(1);
    expect(obs.events.some((e) => e.kind === 'signal_invalid')).toBe(true);
  });

  it('acks (no retry) on an ambiguous failure, emitting signal_ambiguous (avoid duplicate)', async () => {
    const obs = new InMemoryObservabilitySink();
    const m = recorder(VALID);
    // LINE transient + Telegram ambiguous, nothing delivered: retrying could re-send Telegram (no
    // idempotency key), so the message is acked, not redelivered.
    await consumeSignals(
      [m.message],
      notifierReturning({ transientFailures: 1, ambiguousFailures: 1 }),
      obs,
      true,
    );

    expect(m.acked).toBe(1);
    expect(m.retried).toBe(0);
    expect(obs.events.some((e) => e.kind === 'signal_ambiguous')).toBe(true);
  });

  it('retries (does NOT drop) when deliver throws unexpectedly', async () => {
    const obs = new InMemoryObservabilitySink();
    const m = recorder(VALID);
    await consumeSignals([m.message], throwingNotifier, obs, true);

    expect(m.acked).toBe(0);
    expect(m.retried).toBe(1);
    expect(obs.events.some((e) => e.kind === 'signal_consumer_error')).toBe(true);
  });

  it('drops every message without delivering when signals are disabled (kill switch)', async () => {
    const obs = new InMemoryObservabilitySink();
    const m = recorder(VALID);
    let delivered = false;
    await consumeSignals(
      [m.message],
      {
        deliver: async () => {
          delivered = true;
          return RESULT;
        },
      },
      obs,
      false,
    );

    expect(m.acked).toBe(1);
    expect(m.retried).toBe(0);
    expect(delivered).toBe(false); // disabled: no delivery, even for an otherwise-valid job
    expect(obs.events.some((e) => e.kind === 'signal_disabled')).toBe(true);
  });

  it('routes each message in a mixed batch independently', async () => {
    const obs = new InMemoryObservabilitySink();
    const good = recorder(VALID);
    const bad = recorder({ junk: true });
    await consumeSignals(
      [good.message, bad.message],
      notifierReturning({ delivered: 1 }),
      obs,
      true,
    );

    expect(good.acked).toBe(1);
    expect(good.retried).toBe(0);
    expect(bad.acked).toBe(1);
    expect(obs.events.filter((e) => e.kind === 'signal_invalid').length).toBe(1);
    expect(obs.events.filter((e) => e.kind === 'signal_delivered').length).toBe(1);
  });

  it('does nothing on an empty batch', async () => {
    const obs = new InMemoryObservabilitySink();
    await consumeSignals([], notifierReturning({ delivered: 1 }), obs, true);
    expect(obs.events.length).toBe(0);
  });

  it('defaults attempts to 0 when the message has no attempts field', async () => {
    const obs = new InMemoryObservabilitySink();
    const message: AckableMessage = { body: { bad: true }, ack: () => {}, retry: () => {} };
    await consumeSignals([message], notifierReturning({ delivered: 1 }), obs, true);
    expect(obs.events.find((e) => e.kind === 'signal_invalid')?.doubles.attempts).toBe(0);
  });
});

describe('clampDelay', () => {
  it('returns undefined for undefined or non-finite hints', () => {
    expect(clampDelay(undefined)).toBeUndefined();
    expect(clampDelay(Number.NaN)).toBeUndefined();
  });

  it('floors at 5s and caps at 86400s, truncating to an integer', () => {
    expect(clampDelay(2)).toBe(5);
    expect(clampDelay(30.9)).toBe(30);
    expect(clampDelay(999_999)).toBe(86_400);
  });
});
