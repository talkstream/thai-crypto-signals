// Bitkub payload schemas. Envelopes are validated strictly; ticker entries are validated
// individually so one malformed entry never discards the whole tick.

import { z } from 'zod';
import { PayloadValidationError } from '../../domain/errors';
import type { CatalogEntry } from '../../domain/types';

// --- ticker: a bare JSON array; entries carry named string fields (+ optional *_self) ---

const TickerEnvelope = z.array(z.unknown());

export const TickerEntry = z.looseObject({
  symbol: z.string(),
  last: z.string(),
  high_24_hr: z.string(),
  low_24_hr: z.string(),
  highest_bid: z.string(),
  lowest_ask: z.string(),
  base_volume: z.string(),
  quote_volume: z.string(),
  percent_change: z.string(),
});
export type RawTickerEntry = z.infer<typeof TickerEntry>;

/** Validate the ticker envelope is an array; throws on anything else. Entries stay raw. */
export function parseTickerEnvelope(raw: unknown): unknown[] {
  const result = TickerEnvelope.safeParse(raw);
  if (!result.success) {
    throw new PayloadValidationError('ticker payload is not an array', '/api/v3/market/ticker');
  }
  return result.data;
}

/** Per-entry tolerance: returns the typed entry or null (caller counts drift and skips). */
export function safeParseTickerEntry(raw: unknown): RawTickerEntry | null {
  const result = TickerEntry.safeParse(raw);
  return result.success ? result.data : null;
}

// --- symbols: { error, result: [...] } envelope ---

const SymbolEntry = z.looseObject({
  symbol: z.string(),
  base_asset: z.string(),
  quote_asset: z.string(),
  price_scale: z.number().int(),
  quote_asset_scale: z.number().int(),
  market_segment: z.string(),
  status: z.string(),
});

const SymbolsEnvelope = z.object({ error: z.number(), result: z.array(SymbolEntry) });

export function parseSymbols(raw: unknown): CatalogEntry[] {
  const result = SymbolsEnvelope.safeParse(raw);
  if (!result.success) {
    throw new PayloadValidationError('symbols payload malformed', '/api/v3/market/symbols');
  }
  return result.data.result.map((s) => ({
    symbol: s.symbol,
    baseAsset: s.base_asset,
    quoteAsset: s.quote_asset,
    priceScale: s.price_scale,
    quoteScale: s.quote_asset_scale,
    marketSegment: s.market_segment,
    status: s.status,
  }));
}

// --- servertime: bare numeric (string or number) ---

// Strict: a plausible epoch-ms timestamp only. Rejects null/false/true/'' (which z.coerce
// would silently turn into 0/1) so a malformed response falls back to the local clock.
// Bounded to a sane epoch-ms window (~2001..~2096) on BOTH branches, so an absurd digit string
// (e.g. 1e36) or oversized number is rejected rather than producing a garbage bucket.
const PLAUSIBLE_EPOCH_MS = z.number().int().gt(1_000_000_000_000).lt(4_000_000_000_000);
const ServerTime = z.union([
  PLAUSIBLE_EPOCH_MS,
  z
    .string()
    .regex(/^\d{13,}$/)
    .transform(Number)
    .pipe(PLAUSIBLE_EPOCH_MS),
]);

export function parseServerTime(raw: unknown): number {
  const result = ServerTime.safeParse(raw);
  if (!result.success) {
    throw new PayloadValidationError(
      'servertime is not a plausible epoch-ms value',
      '/api/v3/servertime',
    );
  }
  return result.data;
}
