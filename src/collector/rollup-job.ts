import type { Clock, ObservabilitySink } from '../domain/ports';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const GMT7_MS = 7 * HOUR_MS;

export interface RollupDeps {
  db: D1Database;
  obs: ObservabilitySink;
  clock: Clock;
  maxWindows: number;
}

export const hourStart = (ms: number): number => Math.floor(ms / HOUR_MS) * HOUR_MS;
/** Start (UTC ms) of the GMT+7 calendar day containing `ms` — Thai daily candles. */
export const gmt7DayStart = (ms: number): number =>
  Math.floor((ms + GMT7_MS) / DAY_MS) * DAY_MS - GMT7_MS;

// One statement per hour window: set-based OHLC across all symbols. open/close come from the
// first/last bucket via correlated subqueries; high/low/count from a grouped subquery.
const HOURLY_SQL = `INSERT INTO rollups_1h
  (symbol_id, hour_ts, open_minor, high_minor, low_minor, close_minor, price_scale_used, sample_count, finalized)
  SELECT g.symbol_id, ?1,
    (SELECT o.last_minor FROM ticker_snapshots o
       WHERE o.symbol_id = g.symbol_id AND o.bucket_ts >= ?2 AND o.bucket_ts < ?3
       ORDER BY o.bucket_ts ASC LIMIT 1),
    g.hi, g.lo,
    (SELECT c.last_minor FROM ticker_snapshots c
       WHERE c.symbol_id = g.symbol_id AND c.bucket_ts >= ?2 AND c.bucket_ts < ?3
       ORDER BY c.bucket_ts DESC LIMIT 1),
    g.scale, g.n, ?4
  FROM (
    SELECT symbol_id, MAX(last_minor) AS hi, MIN(last_minor) AS lo,
           MAX(price_scale_used) AS scale, COUNT(*) AS n
    FROM ticker_snapshots WHERE bucket_ts >= ?2 AND bucket_ts < ?3 GROUP BY symbol_id
  ) g
  WHERE true
  ON CONFLICT(symbol_id, hour_ts) DO UPDATE SET
    open_minor = excluded.open_minor, high_minor = excluded.high_minor,
    low_minor = excluded.low_minor, close_minor = excluded.close_minor,
    price_scale_used = excluded.price_scale_used, sample_count = excluded.sample_count,
    finalized = excluded.finalized`;

const DAILY_SQL = `INSERT INTO rollups_1d
  (symbol_id, day_ts, open_minor, high_minor, low_minor, close_minor, price_scale_used, sample_count, finalized)
  SELECT g.symbol_id, ?1,
    (SELECT o.open_minor FROM rollups_1h o
       WHERE o.symbol_id = g.symbol_id AND o.hour_ts >= ?2 AND o.hour_ts < ?3
       ORDER BY o.hour_ts ASC LIMIT 1),
    g.hi, g.lo,
    (SELECT c.close_minor FROM rollups_1h c
       WHERE c.symbol_id = g.symbol_id AND c.hour_ts >= ?2 AND c.hour_ts < ?3
       ORDER BY c.hour_ts DESC LIMIT 1),
    g.scale, g.n, ?4
  FROM (
    SELECT symbol_id, MAX(high_minor) AS hi, MIN(low_minor) AS lo,
           MAX(price_scale_used) AS scale, SUM(sample_count) AS n
    FROM rollups_1h WHERE hour_ts >= ?2 AND hour_ts < ?3 GROUP BY symbol_id
  ) g
  WHERE true
  ON CONFLICT(symbol_id, day_ts) DO UPDATE SET
    open_minor = excluded.open_minor, high_minor = excluded.high_minor,
    low_minor = excluded.low_minor, close_minor = excluded.close_minor,
    price_scale_used = excluded.price_scale_used, sample_count = excluded.sample_count,
    finalized = excluded.finalized`;

/** Hourly cron: recompute the last `maxWindows` hourly candles, then the overlapping daily candles. */
export async function rollup(deps: RollupDeps): Promise<void> {
  const { db, clock, maxWindows, obs } = deps;
  const now = clock.now();
  const currentHour = hourStart(now);

  const hourStmts: D1PreparedStatement[] = [];
  for (let i = maxWindows - 1; i >= 0; i -= 1) {
    const h = currentHour - i * HOUR_MS;
    const finalized = h + HOUR_MS <= now ? 1 : 0;
    hourStmts.push(db.prepare(HOURLY_SQL).bind(h, h, h + HOUR_MS, finalized));
  }
  await db.batch(hourStmts);

  const today = gmt7DayStart(now);
  const days = Math.ceil((maxWindows * HOUR_MS) / DAY_MS) + 1;
  const dayStmts: D1PreparedStatement[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = today - i * DAY_MS;
    const finalized = d + DAY_MS <= now ? 1 : 0;
    dayStmts.push(db.prepare(DAILY_SQL).bind(d, d, d + DAY_MS, finalized));
  }
  await db.batch(dayStmts);

  try {
    obs.writeRun(
      { kind: 'rollup', status: 'ok' },
      { hourWindows: hourStmts.length, dayWindows: dayStmts.length },
    );
  } catch {
    // best-effort metric
  }
}
