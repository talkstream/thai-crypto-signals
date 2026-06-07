import type { Mover, SignalJob } from './types';

// ICT (Asia/Bangkok, no DST). `Intl.DateTimeFormat` is configured once at module load — it does NOT
// read the wall clock, so the no-wallclock guard stays satisfied; the bucket time comes from the
// job's `bucketTs` (epoch ms) passed straight to `.formatToParts`.
const ICT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Cap the listed movers so a broad-move tick can't blow past the 4096/5000-char channel limits. */
const MAX_LISTED = 12;

/**
 * One mover line, e.g. `🟢 TON +3.42%  ฿100.00` (up) or `🔴 TON -3.10%  ฿96.80` (down). A green/red
 * circle conveys direction-with-colour where real text colour isn't available (Telegram plain text has
 * none; LINE only via Flex). The pair's quote is stripped for the display name (TON_THB → TON), the
 * sign is explicit, and the price is rendered from integer minor units at the pair's scale.
 */
function formatMover(m: Mover): string {
  const up = m.changeBp > 0;
  const marker = up ? '🟢' : '🔴';
  const base = m.symbol.split('_')[0];
  const pct = (m.changeBp / 100).toFixed(2); // bp → percent; negatives keep their leading '-'
  const signedPct = up ? `+${pct}%` : `${pct}%`;
  const price = (m.priceMinor / 10 ** m.scale).toFixed(m.scale);
  return `${marker} ${base} ${signedPct}  ฿${price}`;
}

/**
 * The signal delivery body: a header with the bucket time in ICT, then one human line per mover
 * (direction, percent, price), capped with a "+N more" tail. Plain text only — sent without a Telegram
 * `parse_mode`, so the literal text (emoji, `฿`, ASCII sign) is injection-safe and needs no escaping.
 */
export function formatSignalMessage(job: SignalJob): string {
  const p = Object.fromEntries(ICT.formatToParts(job.bucketTs).map((x) => [x.type, x.value]));
  const ts = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  const n = job.movers.length;
  const lines = job.movers.slice(0, MAX_LISTED).map(formatMover);
  if (n > MAX_LISTED) lines.push(`… +${n - MAX_LISTED} more`);
  return [`TCS · ${ts} ICT`, ...lines].join('\n');
}

/**
 * A deterministic, valid-format UUID derived from the bucket, used as LINE's `X-Line-Retry-Key` so a
 * queue redelivery of the same bucket is deduplicated server-side by LINE (a 2xx replay returns 409).
 * Pure and stable per bucket — no randomness, no wall-clock.
 */
export function lineRetryKey(bucketTs: number): string {
  const h = bucketTs.toString(16).padStart(16, '0').slice(-16);
  const hex = (h + h).slice(0, 32).split('');
  hex[12] = '4'; // UUID version nibble
  hex[16] = '8'; // UUID variant nibble (10xx)
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
