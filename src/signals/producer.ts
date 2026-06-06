import { safeEvent } from '../domain/obs';
import type { ObservabilitySink, SignalDispatcher } from '../domain/ports';
import type { SignalJob } from './types';

/**
 * DARK: delivery is cut here. With SIGNALS_ENABLED=false the producer records intent and
 * returns WITHOUT touching the dispatcher, so the queue stays provably unfed in production.
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
