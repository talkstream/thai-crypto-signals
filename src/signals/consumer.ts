import { z } from 'zod';
import { errMessage, safeEvent } from '../domain/obs';
import type { ObservabilitySink } from '../domain/ports';
import type { Notifier } from './notifier';

/** Bound a pathological job so an oversized body is dropped, not 4xx-looped against a channel. */
const MAX_SYMBOLS_PER_JOB = 2000;
const MIN_RETRY_S = 5; // floor a transient retry so a flapping endpoint isn't hammered
const MAX_RETRY_S = 86_400; // the queue's delaySeconds ceiling (24h)

const SignalJobSchema = z.object({
  bucketTs: z.number(),
  symbols: z.array(z.string()).max(MAX_SYMBOLS_PER_JOB),
  producedAt: z.number(),
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
 *   - invalid body (or oversized)  -> emit + ack (it can never become valid; never retry)
 *   - any transient channel failure -> emit + retry (no ack); workerd retries up to max_retries -> DLQ
 *   - otherwise (delivered/skipped/permanent) -> emit + ack
 *   - unexpected throw -> emit + retry
 */
export async function consumeSignals(
  messages: readonly AckableMessage[],
  notifier: Notifier,
  obs: ObservabilitySink,
): Promise<void> {
  for (const message of messages) {
    const attempts = message.attempts ?? 0;
    try {
      const parsed = SignalJobSchema.safeParse(message.body);
      if (!parsed.success) {
        safeEvent(obs, 'signal_invalid', {}, { count: 1, attempts });
        message.ack();
        continue;
      }
      const result = await notifier.deliver(parsed.data);
      if (result.transientFailures > 0) {
        safeEvent(
          obs,
          'signal_retry',
          {},
          { transient: result.transientFailures, delivered: result.delivered, attempts },
        );
        const delaySeconds = clampDelay(result.retryAfterSec);
        message.retry(delaySeconds === undefined ? undefined : { delaySeconds });
      } else {
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
        message.ack();
      }
    } catch (e) {
      // deliver()/parse threw unexpectedly: retry (do NOT let it escape — the default would drop it).
      safeEvent(obs, 'signal_consumer_error', { err: errMessage(e) }, { attempts });
      message.retry();
    }
  }
}
