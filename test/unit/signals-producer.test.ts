import { describe, expect, it } from 'vitest';
import { enqueueSignalJob } from '../../src/signals/producer';
import type { SignalJob } from '../../src/signals/types';
import { InMemoryObservabilitySink, InMemorySignalDispatcher } from '../helpers/fakes';

// The producer is now LIVE (wired into collect.ts) and in coverage. No mocks: the dispatcher is an
// in-memory port double at the queue edge (like InMemoryCacheWriter), our producer runs for real.
const job: SignalJob = {
  bucketTs: 1_700_000_040_000,
  symbols: ['BTC_THB'],
  producedAt: 1,
  schemaVersion: 1,
};

describe('enqueueSignalJob', () => {
  it('emits intent and does NOT enqueue when signals are disabled', async () => {
    const dispatcher = new InMemorySignalDispatcher();
    const obs = new InMemoryObservabilitySink();

    const enqueued = await enqueueSignalJob(dispatcher, false, job, obs);

    expect(enqueued).toBe(false);
    expect(dispatcher.jobs.length).toBe(0);
    expect(obs.events.some((e) => e.kind === 'signal_intent')).toBe(true);
  });

  it('enqueues the exact job and reports true when enabled', async () => {
    const dispatcher = new InMemorySignalDispatcher();
    const obs = new InMemoryObservabilitySink();

    const enqueued = await enqueueSignalJob(dispatcher, true, job, obs);

    expect(enqueued).toBe(true);
    expect(dispatcher.jobs).toEqual([job]);
    expect(obs.events.some((e) => e.kind === 'signal_intent')).toBe(false);
  });
});
