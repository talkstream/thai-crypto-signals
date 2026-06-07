import type { SignalJob } from './types';

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
 * The signal delivery body: a concise, plain-text line naming the symbols that fired the rule this
 * bucket (the movers), capped with a "+N more" tail. No markup — sent without a Telegram `parse_mode`,
 * so the literal text is injection-safe (symbol names are exchange-controlled but ASCII tickers, and a
 * date's `-`/`.`/`=` would otherwise need MarkdownV2 escaping).
 */
export function formatSignalMessage(job: SignalJob): string {
  const p = Object.fromEntries(ICT.formatToParts(job.bucketTs).map((x) => [x.type, x.value]));
  const ts = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  const n = job.symbols.length;
  const head = job.symbols.slice(0, MAX_LISTED).join(', ');
  const tail = n > MAX_LISTED ? `, +${n - MAX_LISTED} more` : '';
  return `TCS signal ${ts} ICT — ${n} symbol${n === 1 ? '' : 's'} moved: ${head}${tail}`;
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
