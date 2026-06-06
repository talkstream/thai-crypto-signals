import { ALLOWED_CADENCES } from './constants';

export function isAllowedCadence(minutes: number): boolean {
  return (ALLOWED_CADENCES as readonly number[]).includes(minutes);
}

/**
 * Cron expression for a collect cadence. Throws on any non-60-divisor so a misconfigured
 * cadence fails loudly at config load rather than silently colliding buckets.
 */
export function cronExprFor(minutes: number): string {
  if (!isAllowedCadence(minutes)) {
    throw new Error(
      `COLLECT_CADENCE_MINUTES=${minutes} is not a 60-divisor; allowed: ${ALLOWED_CADENCES.join(', ')}`,
    );
  }
  return minutes === 1 ? '* * * * *' : `*/${minutes} * * * *`;
}

/** Floor a server timestamp (ms) to the start of its cadence bucket. */
export function bucketTsFor(serverMs: number, cadenceMinutes: number): number {
  const span = 60_000 * cadenceMinutes;
  return Math.floor(serverMs / span) * span;
}
