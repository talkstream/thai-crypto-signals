// Pure parsers for the in-bot UI. No I/O, no wall-clock.

/** A decoded inline-button action, or null for stale/forged/garbage callback_data. */
export type Callback =
  | { kind: 'main' }
  | { kind: 'thresholdMenu' }
  | { kind: 'setThreshold'; bp: number }
  | { kind: 'customThreshold' }
  | { kind: 'addMenu' }
  | { kind: 'addSymbol'; symbol: string }
  | { kind: 'customAdd' }
  | { kind: 'removeMenu' }
  | { kind: 'removeSymbol'; symbol: string };

/** Only these thresholds are offered as buttons; any other `t:NNN` is a stale/forged keyboard. */
const THRESHOLD_SAFELIST = new Set([100, 300, 500, 1000]);

/**
 * A user-typed threshold percent → basis points, or null if not a sane whole percent in 1..100.
 * (Integer percent only: the UI deals in whole %, and `pct*100` is an exact bp.)
 */
export function parseThresholdPercent(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const pct = Number(t);
  return pct >= 1 && pct <= 100 ? pct * 100 : null;
}

/** Uppercase + trim a typed symbol; the caller validates it against the live Bitkub catalog. */
export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Decode callback_data (authored from a fixed scheme) into an action, or null. */
export function decodeCallback(data: string): Callback | null {
  // The exact matches (incl. `t:x`/`a:x`) MUST be decoded before the `t:`/`a:`/`r:` prefix arms below:
  // e.g. `a:x` (length 3) would otherwise fall through and decode as addSymbol with symbol "x".
  switch (data) {
    case 'm':
      return { kind: 'main' };
    case 't':
      return { kind: 'thresholdMenu' };
    case 't:x':
      return { kind: 'customThreshold' };
    case 'a':
      return { kind: 'addMenu' };
    case 'a:x':
      return { kind: 'customAdd' };
    case 'r':
      return { kind: 'removeMenu' };
  }
  if (data.startsWith('t:')) {
    const bp = Number(data.slice(2));
    return Number.isInteger(bp) && THRESHOLD_SAFELIST.has(bp) ? { kind: 'setThreshold', bp } : null;
  }
  if (data.startsWith('a:') && data.length > 2) return { kind: 'addSymbol', symbol: data.slice(2) };
  if (data.startsWith('r:') && data.length > 2)
    return { kind: 'removeSymbol', symbol: data.slice(2) };
  return null;
}
