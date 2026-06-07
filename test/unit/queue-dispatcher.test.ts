import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { QueueDispatcher } from '../../src/adapters/signals/queue-dispatcher';
import type { SignalJob } from '../../src/signals/types';

// No mock: the dispatcher wraps the REAL bound queue (env.SIGNALS_QUEUE) provided by the Workers
// test pool, so `.send` runs for real against Miniflare's queue — contract replay at the edge.
describe('QueueDispatcher', () => {
  it('sends the job to the bound producer queue', async () => {
    const dispatcher = new QueueDispatcher(env.SIGNALS_QUEUE);
    const job: SignalJob = { bucketTs: 1, symbols: ['BTC_THB'], producedAt: 2, schemaVersion: 1 };
    // Miniflare's Queue.send() exposes no read-back API in the test pool, so we assert no exception
    // (= the send was accepted by the runtime); the payload round-trip is covered by the consumer test.
    await expect(dispatcher.enqueue(job)).resolves.toBeUndefined();
  });
});
