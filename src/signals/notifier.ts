import type { SignalJob } from './types';

/**
 * Outcome of delivering one job. Per-channel notifiers return single-unit counts; the FanOut sums
 * them. The consumer's ack/retry decision reads only `transientFailures` (>0 ⇒ retry the message);
 * `delivered`/`skipped`/`permanentFailures` are all terminal (ack). `retryAfterSec` is an optional
 * delay hint (max across transient channels) fed to the queue's retry backoff.
 */
export interface DeliveryResult {
  /** 2xx (or an idempotent replay, e.g. LINE 409). */
  delivered: number;
  /** Channel not configured (no secret) — nothing attempted. */
  skipped: number;
  /** 4xx (non-429): a malformed/forbidden request that will never succeed — do NOT retry. */
  permanentFailures: number;
  /** 429 / 5xx / network error — retry the message. */
  transientFailures: number;
  /** Suggested retry delay in seconds (e.g. Telegram `parameters.retry_after`). */
  retryAfterSec?: number;
}

/** A delivery channel. Implementations resolve `fetch` via an injected Fetcher at CALL time. */
export interface Notifier {
  deliver(job: SignalJob): Promise<DeliveryResult>;
}
