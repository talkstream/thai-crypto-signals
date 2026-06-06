// NO-FLOAT price math. Decimal strings <-> bigint minor units, exact to int64.

import { MAX_SAFE_MINOR, PCT_BP_SCALE } from '../config/constants';
import { DecimalParseError, ScaleOverflowError } from './errors';

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Parse a decimal string (e.g. "2017050.88") into bigint minor units at `scale`
 * (e.g. 201705088n at scale 2). Fractional digits beyond `scale` are truncated toward
 * zero (deterministic); fewer are right-padded. Throws on malformed input or int64 overflow.
 */
export function parseDecimalToMinor(raw: string, scale: number, symbol = ''): bigint {
  if (!DECIMAL_RE.test(raw)) throw new DecimalParseError(raw, symbol);

  const negative = raw.charCodeAt(0) === 45; // '-'
  const unsigned = negative ? raw.slice(1) : raw;
  const dot = unsigned.indexOf('.');
  const intPart = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fracRaw = dot === -1 ? '' : unsigned.slice(dot + 1);
  const frac = fracRaw.length >= scale ? fracRaw.slice(0, scale) : fracRaw.padEnd(scale, '0');

  const magnitude = BigInt(`${intPart}${frac}`);
  if (magnitude > MAX_SAFE_MINOR) throw new ScaleOverflowError(symbol, scale, raw);
  return negative ? -magnitude : magnitude;
}

/**
 * Canonical inverse of {@link parseDecimalToMinor}: bigint minor units -> decimal string,
 * trailing zeros trimmed. The single formatter used by both the D1 read path and the KV
 * cache so the public contract is byte-identical regardless of cache state.
 */
export function formatMinorToDecimal(minor: bigint, scale: number): string {
  if (scale <= 0) return minor.toString();

  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(scale + 1, '0');
  const cut = digits.length - scale;
  const intPart = digits.slice(0, cut);
  const frac = digits.slice(cut).replace(/0+$/, '');
  const body = frac ? `${intPart}.${frac}` : intPart;
  return negative ? `-${body}` : body;
}

/** Convert a percent string ("-0.94") to integer basis points (-94). */
export function pctToBasisPoints(raw: string): number {
  return Number(parseDecimalToMinor(raw, PCT_BP_SCALE));
}

/**
 * Restate a minor-unit value from one price scale to another so values stored at different
 * scales can be compared/aggregated. Exact for scale increases; truncates toward zero for
 * decreases (lossy by definition, but scale decreases are not expected in practice).
 */
export function rescaleMinor(value: bigint, fromScale: number, toScale: number): bigint {
  if (fromScale === toScale) return value;
  if (fromScale < toScale) return value * 10n ** BigInt(toScale - fromScale);
  return value / 10n ** BigInt(fromScale - toScale);
}
