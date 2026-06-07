import { safeEvent } from '../domain/obs';
import type { ObservabilitySink, SignalDispatcher } from '../domain/ports';
import type { SignalJob } from './types';

/**
 * DORMANT phase-2 producer. The `signalsEnabled` flag-gate is a PARAMETER for the day phase-2 wires
 * this in; today `enqueueSignalJob` has NO runtime caller anywhere in src/, so the queue is
 * structurally unfed in production regardless of the flag. Frozen and type-checked, not
 * test-exercised — see src/signals/contract.ts.
 */
export async function enqueueSignalJob(
  dispatcher: SignalDispatcher,
  signalsEnabled: boolean,
  job: SignalJob,
  obs: ObservabilitySink,
): Promise<boolean> {
  if (!signalsEnabled) {
    safeEvent(obs, 'signal_intent', {}, { symbols: job.symbols.length });
    return false;
  }
  await dispatcher.enqueue(job);
  return true;
}
