import { z } from 'zod';
import { errMessage, safeEvent } from '../domain/obs';
import type { ObservabilitySink } from '../domain/ports';
import type { Notifier } from './notifier';

/** Bound a pathological job so an oversized body is dropped, not 4xx-looped against a channel. */
const MAX_SYMBOLS_PER_JOB = 2000;
const MIN_RETRY_S = 5; // floor a transient retry so a flapping endpoint isn't hammered
const MAX_RETRY_S = 86_400; // the queue's delaySeconds ceiling (24h)
/** JS Date range ceiling (ms); beyond this, Intl date formatting throws RangeError. */
const MAX_EPOCH_MS = 8_640_000_000_000_000;

const SignalJobSchema = z.object({
  // Constrain to a valid epoch-ms integer: a non-finite OR out-of-Date-range bucketTs would otherwise
  // throw in Intl date formatting (RangeError) or make a garbage retry key — a permanently invalid
  // body that would loop on retry instead of being dropped here as invalid.
  bucketTs: z.number().int().min(0).max(MAX_EPOCH_MS),
  symbols: z.array(z.string()).max(MAX_SYMBOLS_PER_JOB),
  producedAt: z.number().int().min(0).max(MAX_EPOCH_MS),
  schemaVersion: z.literal(1),
});

/** Coerce an upstream retry hint to a positive integer within the queue's [MIN, MAX] delay bounds. */
export function clampDelay(seconds?: number): number | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
  return Math.min(MAX_RETRY_S, Math.max(MIN_RETRY_S, Math.trunc(seconds)));
}

/** A queue message: the real Cloudflare `Message` satisfies this structurally. */
export interface AckableMessage {
  body: unknown;
  attempts?: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

/**
 * Live queue consumer: parse -> deliver -> ack. Each message hits EXACTLY one of ack()/retry() inside
 * its own try/catch — never letting a throw escape, because a successful handler return ACKs (drops)
 * any un-dispositioned message by default, and a rejected handler retries the whole batch. Disposition:
 *   - signals disabled (kill switch) -> emit + ack (drop; no delivery even for in-flight messages)
 *   - invalid body (or oversized)  -> emit + ack (it can never become valid; never retry)
 *   - a transient failure, no ambiguous failure, NO non-idempotent (Telegram) delivery -> emit + retry
 *     (no ack; up to max_retries -> DLQ) — recovers the failed channel; idempotent re-sends dedup
 *   - an AMBIGUOUS failure (non-idempotent channel may have taken effect) -> emit signal_ambiguous + ack
 *   - a transient failure we can't safely retry (a non-idempotent channel delivered) -> signal_partial + ack
 *   - at least one channel delivered -> emit signal_delivered + ack
 *   - nothing delivered, no transient/ambiguous (only skipped/permanent) -> emit signal_undelivered + ack
 *   - unexpected throw (defensive; FanOut itself never throws) -> emit + retry
 *
 * Delivery is AT-LEAST-ONCE (Cloudflare Queues redeliver). The retry rule recovers a transiently-failed
 * channel WITHOUT duplicating any delivered one: it redelivers only when no non-idempotent channel
 * (Telegram) has delivered, so the re-sent channels are all idempotent — LINE (X-Line-Retry-Key) and the
 * webhook (signed `bucketTs` for receiver dedup) absorb the replay; not-yet-delivered channels simply
 * get their first attempt. Telegram (no idempotency key) is acked on ambiguous transport failures
 * (at-most-once there); the only residual loss is a transient failure ALONGSIDE a Telegram delivery,
 * which is acked rather than retried (the irreducible limit of whole-message retry — per-channel queue
 * jobs would remove it). Telegram can still duplicate only on the rare lost-ack redelivery.
 *
 * `signalsEnabled` gates the CONSUME side too: with the flag off, queued/redelivered messages are
 * dropped, not delivered — so the committed `SIGNALS_ENABLED="false"` is a true delivery kill switch,
 * not just an enqueue gate.
 */
export async function consumeSignals(
  messages: readonly AckableMessage[],
  notifier: Notifier,
  obs: ObservabilitySink,
  signalsEnabled: boolean,
): Promise<void> {
  for (const message of messages) {
    const attempts = message.attempts ?? 0;
    try {
      if (!signalsEnabled) {
        safeEvent(obs, 'signal_disabled', {}, { count: 1, attempts });
        message.ack();
        continue;
      }
      const parsed = SignalJobSchema.safeParse(message.body);
      if (!parsed.success) {
        safeEvent(obs, 'signal_invalid', {}, { count: 1, attempts });
        message.ack();
        continue;
      }
      const result = await notifier.deliver(parsed.data);
      if (
        result.transientFailures > 0 &&
        result.ambiguousFailures === 0 &&
        result.nonIdempotentDelivered === 0
      ) {
        // Retry-safe: no ambiguous failure and NO non-idempotent (Telegram) delivery, so a queue
        // redelivery re-sends only idempotent channels (LINE retry-key / webhook receiver-dedup absorb
        // the replay) and re-attempts the not-yet-delivered ones — recovering a transiently-failed
        // channel WITHOUT duplicating any delivered one. (A no-mover next tick would NOT carry this
        // signal, so recovering it here matters now that signals are movers, not heartbeats.)
        safeEvent(obs, 'signal_retry', {}, { transient: result.transientFailures, attempts });
        const delaySeconds = clampDelay(result.retryAfterSec);
        message.retry(delaySeconds === undefined ? undefined : { delaySeconds });
      } else {
        if (result.ambiguousFailures > 0) {
          // A non-idempotent channel (Telegram) failed ambiguously: ack rather than redeliver, so the
          // send is not duplicated (it may already have taken effect); that channel is at-most-once here.
          safeEvent(
            obs,
            'signal_ambiguous',
            {},
            { delivered: result.delivered, ambiguous: result.ambiguousFailures, attempts },
          );
        } else if (result.transientFailures > 0) {
          // Partial we cannot safely retry: a non-idempotent channel (Telegram) delivered, so a
          // redelivery would duplicate it. We ack — the transiently-failed channel misses THIS signal
          // (the irreducible at-least-once limit of whole-message retry + a non-idempotent channel;
          // per-channel queue jobs would remove it).
          safeEvent(
            obs,
            'signal_partial',
            {},
            { delivered: result.delivered, transient: result.transientFailures, attempts },
          );
        } else if (result.delivered > 0) {
          safeEvent(
            obs,
            'signal_delivered',
            {},
            {
              delivered: result.delivered,
              skipped: result.skipped,
              permanent: result.permanentFailures,
            },
          );
        } else {
          // delivered=0 with no transient/ambiguous: only skipped (unconfigured channels) and/or
          // permanent failures — nothing was actually delivered, so do not claim a delivery.
          safeEvent(
            obs,
            'signal_undelivered',
            {},
            { skipped: result.skipped, permanent: result.permanentFailures, attempts },
          );
        }
        message.ack();
      }
    } catch (e) {
      // deliver()/parse threw unexpectedly: retry (do NOT let it escape — the default would drop it).
      safeEvent(obs, 'signal_consumer_error', { err: errMessage(e) }, { attempts });
      message.retry();
    }
  }
}
