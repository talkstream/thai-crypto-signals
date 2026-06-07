import type { SignalDispatcher } from '../../domain/ports';
import type { SignalJob } from '../../signals/types';

/**
 * Phase-2 producer adapter, now LIVE: wraps the Queue producer binding and is instantiated in
 * src/index.ts for the collect path. Whether anything is actually sent is gated by SIGNALS_ENABLED
 * (checked at the wiring site). In coverage; its conformance to the SignalDispatcher port is also
 * pinned at compile time in src/signals/contract.ts.
 */
export class QueueDispatcher implements SignalDispatcher {
  constructor(private readonly queue: Queue<SignalJob>) {}
  async enqueue(job: SignalJob): Promise<void> {
    await this.queue.send(job);
  }
}
