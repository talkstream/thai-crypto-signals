import type { DeliveryResult, Notifier } from '../notifier';
import type { SignalJob } from '../types';
import { ambiguous } from './result';

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

/**
 * Delivers one job to every channel and sums the per-channel results. Channels run in parallel — the
 * count is small (≤3), well under the 6 simultaneous-connections limit; the consumer iterates batch
 * messages sequentially so total in-flight stays bounded. `retryAfterSec` is the max across channels.
 */
export class FanOutNotifier implements Notifier {
  constructor(private readonly channels: readonly Notifier[]) {}

  async deliver(job: SignalJob): Promise<DeliveryResult> {
    // allSettled, never reject: an unexpected throw from one channel must NOT discard the results of
    // channels that already completed in parallel (and could be a real send). A thrown channel becomes
    // an AMBIGUOUS failure — the consumer then acks (no retry) rather than re-sending the completed ones.
    const settled = await Promise.allSettled(this.channels.map((c) => c.deliver(job)));
    const results = settled.map((s) => (s.status === 'fulfilled' ? s.value : ambiguous()));
    return results.reduce<DeliveryResult>(
      (acc, r) => {
        const retryAfterSec = maxDefined(acc.retryAfterSec, r.retryAfterSec);
        const next: DeliveryResult = {
          delivered: acc.delivered + r.delivered,
          nonIdempotentDelivered: acc.nonIdempotentDelivered + r.nonIdempotentDelivered,
          skipped: acc.skipped + r.skipped,
          permanentFailures: acc.permanentFailures + r.permanentFailures,
          transientFailures: acc.transientFailures + r.transientFailures,
          ambiguousFailures: acc.ambiguousFailures + r.ambiguousFailures,
        };
        // Only set the optional field when present (exactOptionalPropertyTypes).
        if (retryAfterSec !== undefined) next.retryAfterSec = retryAfterSec;
        return next;
      },
      {
        delivered: 0,
        nonIdempotentDelivered: 0,
        skipped: 0,
        permanentFailures: 0,
        transientFailures: 0,
        ambiguousFailures: 0,
      },
    );
  }
}
