import type { DeliveryResult } from '../notifier';

// Single-channel DeliveryResult constructors. The FanOut sums these across channels.
const ZERO = {
  delivered: 0,
  skipped: 0,
  permanentFailures: 0,
  transientFailures: 0,
  ambiguousFailures: 0,
} as const;

export const delivered = (): DeliveryResult => ({ ...ZERO, delivered: 1 });
export const skipped = (): DeliveryResult => ({ ...ZERO, skipped: 1 });
export const permanent = (): DeliveryResult => ({ ...ZERO, permanentFailures: 1 });
/** Retry-safe failure (not-yet-delivered or an idempotent channel) — the consumer may retry. */
export const transient = (retryAfterSec?: number): DeliveryResult =>
  retryAfterSec === undefined
    ? { ...ZERO, transientFailures: 1 }
    : { ...ZERO, transientFailures: 1, retryAfterSec };
/** Ambiguous failure on a non-idempotent channel — a retry could duplicate, so do NOT retry. */
export const ambiguous = (): DeliveryResult => ({ ...ZERO, ambiguousFailures: 1 });
