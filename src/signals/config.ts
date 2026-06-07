import type { SignalConfigStore } from '../domain/ports';

/**
 * The live signal config the in-bot Telegram UI edits and the producer reads each tick. It supersedes
 * the static `SIGNAL_WATCHLIST` / `SIGNAL_PCT_THRESHOLD_BP` env vars, which now only seed the default.
 */
export interface SignalConfig {
  /** Symbols allowed to fire a signal (empty = all symbols). */
  watchlist: string[];
  /** A mover must move >= this many basis points vs the prior bucket (300 = 3%). */
  thresholdBp: number;
}

/**
 * The stored config if the row is present, else the supplied `defaults` (seeded from the SIGNAL_* env
 * vars). One read per collect tick; the store (D1) is strongly consistent, so an edit applies next tick.
 */
export async function resolveSignalConfig(
  store: SignalConfigStore,
  defaults: SignalConfig,
): Promise<SignalConfig> {
  return (await store.load()) ?? defaults;
}
