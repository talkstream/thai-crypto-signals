import type { SignalJob } from './types';

/**
 * Outcome of delivering one job. Per-channel notifiers return single-unit counts; the FanOut sums
 * them. The consumer retries ONLY when `delivered === 0 && transientFailures > 0 && ambiguousFailures
 * === 0` — so a whole-job redelivery never re-sends a channel that already delivered (none did) and
 * never re-sends a non-idempotent channel whose request may have taken effect. `retryAfterSec` is an
 * optional delay hint (max across transient channels) fed to the queue's retry backoff.
 */
export interface DeliveryResult {
  /** 2xx (or an idempotent replay, e.g. LINE 409). */
  delivered: number;
  /** Of `delivered`, how many were on a NON-idempotent channel (Telegram) whose re-send on a queue
   *  redelivery WOULD duplicate. When this is 0, a redelivery is safe (LINE retry-key + webhook
   *  receiver-dedup absorb the re-sends), so the consumer may retry to recover a failed channel. */
  nonIdempotentDelivered: number;
  /** Channel not configured (no secret) — nothing attempted. */
  skipped: number;
  /** 4xx (non-429): a malformed/forbidden request that will never succeed — do NOT retry. */
  permanentFailures: number;
  /** Retry-safe failure: not-yet-delivered (e.g. 429) OR an idempotent channel (LINE retry-key,
   *  webhook receiver-dedup) where a redelivery cannot duplicate — the consumer may retry. */
  transientFailures: number;
  /** AMBIGUOUS failure on a NON-idempotent channel (Telegram 5xx / network error): the request may
   *  have taken effect, and Telegram has no idempotency key, so a retry could duplicate — do NOT retry. */
  ambiguousFailures: number;
  /** Suggested retry delay in seconds (e.g. Telegram `parameters.retry_after`). */
  retryAfterSec?: number;
}

/** A delivery channel. Implementations resolve `fetch` via an injected Fetcher at CALL time. */
export interface Notifier {
  deliver(job: SignalJob): Promise<DeliveryResult>;
}
