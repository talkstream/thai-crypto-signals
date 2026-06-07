import { safeEvent } from '../domain/obs';
import type { ObservabilitySink, SignalDispatcher } from '../domain/ports';
import type { SignalJob } from './types';

/**
 * Phase-2 producer, now LIVE: called from the collect path (src/collector/collect.ts) on each
 * successful non-overlap tick. The `signalsEnabled` flag-gate decides whether the job is actually
 * enqueued; when false it emits intent only (no enqueue), so the queue stays structurally unfed.
 * Covered by test/unit/signals-producer.test.ts; the wire shape is frozen in src/signals/contract.ts.
 */
export async function enqueueSignalJob(
  dispatcher: SignalDispatcher,
  signalsEnabled: boolean,
  job: SignalJob,
  obs: ObservabilitySink,
): Promise<boolean> {
  if (!signalsEnabled) {
    safeEvent(obs, 'signal_intent', {}, { movers: job.movers.length });
    return false;
  }
  await dispatcher.enqueue(job);
  return true;
}
