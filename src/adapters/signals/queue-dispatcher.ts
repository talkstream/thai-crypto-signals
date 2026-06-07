import type { SignalDispatcher } from '../../domain/ports';
import type { SignalJob } from '../../signals/types';

/**
 * DORMANT phase-2 component. Wraps the Queue producer binding for the day signals ship. It is NEVER
 * instantiated by the running worker today (the producer has no runtime caller), so the queue is
 * structurally unfed in production — a wiring fact, not a runtime SIGNALS_ENABLED check. Carved out
 * of coverage; its conformance to the SignalDispatcher port is pinned at compile time in
 * src/signals/contract.ts.
 */
export class QueueDispatcher implements SignalDispatcher {
  constructor(private readonly queue: Queue<SignalJob>) {}
  async enqueue(job: SignalJob): Promise<void> {
    await this.queue.send(job);
  }
}
