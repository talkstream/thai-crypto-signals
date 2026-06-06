// Shared output DTOs. The SAME formatter feeds the KV hot-cache (written by the collector)
// and the read API (rebuilt from D1), so the public contract is byte-identical either way.

import { formatMinorToDecimal } from './price';
import type { TickerSnapshot } from './types';

export interface LatestEntryDto {
  symbol: string;
  last: string;
  bid: string | null;
  ask: string | null;
  pctChangeBp: number;
  observedMs: number;
}

export interface LatestDto {
  bucketTs: number;
  writtenAtMs: number;
  entries: LatestEntryDto[];
}

export function toLatestEntry(symbol: string, s: TickerSnapshot): LatestEntryDto {
  return {
    symbol,
    last: formatMinorToDecimal(s.lastMinor, s.priceScaleUsed),
    bid: s.bidMinor === null ? null : formatMinorToDecimal(s.bidMinor, s.priceScaleUsed),
    ask: s.askMinor === null ? null : formatMinorToDecimal(s.askMinor, s.priceScaleUsed),
    pctChangeBp: s.pctChangeBp,
    observedMs: s.observedMs,
  };
}
