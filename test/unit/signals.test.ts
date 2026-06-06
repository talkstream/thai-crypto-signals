import { describe, expect, it } from 'vitest';
import { QueueDispatcher } from '../../src/adapters/signals/queue-dispatcher';
import { NotImplementedError } from '../../src/domain/errors';
import { consumeSignals } from '../../src/signals/consumer';
import {
  nPeriodHighLow,
  percentChange,
  smaCross,
  thresholdCross,
} from '../../src/signals/indicators';
import { NoopNotifier } from '../../src/signals/notifier';
import { enqueueSignalJob } from '../../src/signals/producer';
import type { SignalJob } from '../../src/signals/types';
import { InMemoryObservabilitySink, InMemorySignalDispatcher } from '../helpers/fakes';

const job: SignalJob = { bucketTs: 1, symbols: ['BTC_THB'], producedAt: 2, schemaVersion: 1 };

describe('indicators (dark seam)', () => {
  it('throw NotImplemented in v1', () => {
    expect(() => percentChange([1n])).toThrow(NotImplementedError);
    expect(() => thresholdCross([1n], 2n)).toThrow(NotImplementedError);
    expect(() => smaCross([1n], 2)).toThrow(NotImplementedError);
    expect(() => nPeriodHighLow([1n], 2)).toThrow(NotImplementedError);
  });
});

describe('NoopNotifier', () => {
  it('skips delivery and logs intent', async () => {
    const obs = new InMemoryObservabilitySink();
    expect(await new NoopNotifier(obs).deliver(job)).toEqual({ ok: true, skipped: true });
    expect(obs.events.some((e) => e.kind === 'notify_skipped')).toBe(true);
  });
});

describe('enqueueSignalJob (flag-gated producer)', () => {
  it('does NOT enqueue when signals are disabled', async () => {
    const dispatcher = new InMemorySignalDispatcher();
    const obs = new InMemoryObservabilitySink();
    expect(await enqueueSignalJob(dispatcher, false, job, obs)).toBe(false);
    expect(dispatcher.jobs.length).toBe(0);
    expect(obs.events.some((e) => e.kind === 'signal_intent')).toBe(true);
  });

  it('enqueues to the port when enabled', async () => {
    const dispatcher = new InMemorySignalDispatcher();
    expect(await enqueueSignalJob(dispatcher, true, job, new InMemoryObservabilitySink())).toBe(
      true,
    );
    expect(dispatcher.jobs).toEqual([job]);
  });
});

describe('consumeSignals (ack-and-drop)', () => {
  it('acks valid and invalid messages and flags the invalid one', () => {
    const obs = new InMemoryObservabilitySink();
    let acks = 0;
    const ack = () => {
      acks += 1;
    };
    consumeSignals(
      [
        { body: job, ack },
        { body: { nope: true }, ack },
      ],
      obs,
    );
    expect(acks).toBe(2);
    expect(obs.events.filter((e) => e.kind === 'signal_invalid').length).toBe(1);
  });
});

describe('QueueDispatcher', () => {
  it('sends the job to the queue', async () => {
    const sent: SignalJob[] = [];
    const queue = {
      send: async (m: SignalJob) => {
        sent.push(m);
      },
    } as unknown as Queue<SignalJob>;
    await new QueueDispatcher(queue).enqueue(job);
    expect(sent).toEqual([job]);
  });
});
