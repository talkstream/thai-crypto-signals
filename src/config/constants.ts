// Frozen, dependency-free constants. No wall-clock, no I/O.

/**
 * Lossless storage ceiling for minor-unit prices. Verified empirically against the
 * D1/Miniflare runtime: D1 rejects bigint binds (D1_TYPE_ERROR) and returns INTEGER columns
 * as JS `number`, which is exact only up to 2^53-1. So we bind Number(minor) — always within
 * this bound for real Bitkub prices — and reject anything larger via ScaleOverflow.
 */
export const MAX_SAFE_MINOR = 9007199254740991n; // === BigInt(Number.MAX_SAFE_INTEGER)

/** Basis points = percent * 100, i.e. a decimal scale of 2 applied to percent_change. */
export const PCT_BP_SCALE = 2;

/** Documented Bitkub penalty window after an HTTP 429 (informational). */
export const RATE_LIMIT_BLOCK_MS = 30_000;

/**
 * Allowed collect cadences (minutes). Restricted to 60-divisors so the per-N-minute cron
 * firing pattern and the continuous-epoch bucket stay 1:1 — non-divisors (7, 13, 14, …)
 * collide the bucket at the top of the hour.
 */
export const ALLOWED_CADENCES = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30] as const;

/** A tick whose price moves >= this factor vs the immediately-preceding bucket is flagged. */
export const SANITY_JUMP_FACTOR = 10n;
