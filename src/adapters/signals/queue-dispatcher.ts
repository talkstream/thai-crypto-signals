import type { SignalDispatcher } from '../../domain/ports';
import type { SignalJob } from '../../signals/types';

/** Production dispatcher wrapping the Queue producer binding. Only used when SIGNALS_ENABLED. */
export class QueueDispatcher implements SignalDispatcher {
  constructor(private readonly queue: Queue<SignalJob>) {}
  async enqueue(job: SignalJob): Promise<void> {
    await this.queue.send(job);
  }
}
