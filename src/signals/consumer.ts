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
 *   - NOTHING delivered + a transient failure -> emit + retry (no ack); retried up to max_retries -> DLQ
 *   - a transient failure ALONGSIDE a success (partial) -> emit signal_partial + ack
 *   - otherwise (delivered/skipped/permanent) -> emit + ack
 *   - unexpected throw -> emit + retry
 *
 * Retrying ONLY when nothing was delivered keeps redelivery duplicate-free: re-running every channel
 * on a queue redelivery can never re-send an already-successful channel, because none succeeded this
 * attempt. A channel that transiently failed while another succeeded is retried on the next tick, not
 * by redelivering this message (which would duplicate the channel that already delivered).
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
      if (result.delivered === 0 && result.transientFailures > 0) {
        // Nothing delivered: safe to retry — re-running all channels cannot duplicate a prior send.
        safeEvent(obs, 'signal_retry', {}, { transient: result.transientFailures, attempts });
        const delaySeconds = clampDelay(result.retryAfterSec);
        message.retry(delaySeconds === undefined ? undefined : { delaySeconds });
      } else {
        if (result.transientFailures > 0) {
          // Partial: a channel delivered, so acking avoids re-sending it; the transient channel is
          // retried on the next tick, not by redelivering this (which would duplicate the delivered one).
          safeEvent(
            obs,
            'signal_partial',
            {},
            { delivered: result.delivered, transient: result.transientFailures, attempts },
          );
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
