/**
 * Parse the `SIGNAL_WATCHLIST` var (e.g. "TON_THB,BTC_THB") into a set of symbols allowed to fire a
 * signal. Whitespace is trimmed and blanks dropped. An empty/absent value yields an empty set, which
 * the producer treats as "all symbols" (no filtering).
 */
export function parseWatchlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}
