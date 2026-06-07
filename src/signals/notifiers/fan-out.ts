import type { DeliveryResult, Notifier } from '../notifier';
import type { SignalJob } from '../types';

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
    const results = await Promise.all(this.channels.map((c) => c.deliver(job)));
    return results.reduce<DeliveryResult>(
      (acc, r) => {
        const retryAfterSec = maxDefined(acc.retryAfterSec, r.retryAfterSec);
        const next: DeliveryResult = {
          delivered: acc.delivered + r.delivered,
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
        skipped: 0,
        permanentFailures: 0,
        transientFailures: 0,
        ambiguousFailures: 0,
      },
    );
  }
}
