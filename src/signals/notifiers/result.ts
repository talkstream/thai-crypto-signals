import type { DeliveryResult } from '../notifier';

// Single-channel DeliveryResult constructors. The FanOut sums these across channels.
const ZERO = { delivered: 0, skipped: 0, permanentFailures: 0, transientFailures: 0 } as const;

export const delivered = (): DeliveryResult => ({ ...ZERO, delivered: 1 });
export const skipped = (): DeliveryResult => ({ ...ZERO, skipped: 1 });
export const permanent = (): DeliveryResult => ({ ...ZERO, permanentFailures: 1 });
export const transient = (retryAfterSec?: number): DeliveryResult =>
  retryAfterSec === undefined
    ? { ...ZERO, transientFailures: 1 }
    : { ...ZERO, transientFailures: 1, retryAfterSec };
