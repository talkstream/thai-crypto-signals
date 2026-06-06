import { errMessage, safeEvent } from '../domain/obs';
import type { Clock, MarketDataSource, ObservabilitySink, SymbolStore } from '../domain/ports';
import { gmt7DayStart } from './rollup-job';

const DAY_MS = 86_400_000;

export interface MaintenanceDeps {
  db: D1Database;
  marketData: MarketDataSource;
  symbols: SymbolStore;
  obs: ObservabilitySink;
  clock: Clock;
  retentionDays: number;
  runsRetentionDays: number;
  rollups1hRetentionDays: number;
}

const RUN_SQL = `INSERT OR REPLACE INTO collection_runs
  (bucket_ts, kind, status, started_ms, finished_ms, server_ts_ms, symbols_seen, rows_inserted,
   rows_skipped, drift_count, scale_overflow_count, rows_written, skew_ms, http_status, duration_ms, error_detail)
  VALUES (?, ?, ?, ?, ?, NULL, 0, ?, 0, 0, 0, ?, NULL, NULL, ?, ?)`;

async function recordRun(
  db: D1Database,
  dayTs: number,
  kind: string,
  status: string,
  startedMs: number,
  finishedMs: number,
  rows: number,
  errorDetail: string | null,
): Promise<void> {
  await db
    .prepare(RUN_SQL)
    .bind(
      dayTs,
      kind,
      status,
      startedMs,
      finishedMs,
      rows,
      rows,
      finishedMs - startedMs,
      errorDetail,
    )
    .run();
}

/** Daily cron: refresh the symbol catalog, prune raw snapshots and the old collect ledger. */
export async function maintenance(deps: MaintenanceDeps): Promise<void> {
  const {
    db,
    marketData,
    symbols,
    obs,
    clock,
    retentionDays,
    runsRetentionDays,
    rollups1hRetentionDays,
  } = deps;
  const now = clock.now();
  const dayTs = gmt7DayStart(now);

  // 1. Catalog refresh (best-effort; a fetch failure must not block pruning).
  const catStart = clock.now();
  try {
    const catalog = await marketData.getSymbols();
    await symbols.upsertMany(catalog, now);
    await recordRun(db, dayTs, 'catalog', 'ok', catStart, clock.now(), catalog.length, null);
    safeEvent(obs, 'catalog', { status: 'ok' }, { count: catalog.length });
  } catch (e) {
    await recordRun(db, dayTs, 'catalog', 'failed', catStart, clock.now(), 0, errMessage(e));
    safeEvent(obs, 'catalog', { status: 'failed' }, { count: 0 });
  }

  // 2. Prune raw snapshots past retention and the old collect ledger.
  const pruneStart = clock.now();
  const rawCutoff = now - retentionDays * DAY_MS;
  const rawRes = await db
    .prepare('DELETE FROM ticker_snapshots WHERE bucket_ts < ?')
    .bind(rawCutoff)
    .run();
  const runsCutoff = now - runsRetentionDays * DAY_MS;
  const runsRes = await db
    .prepare('DELETE FROM collection_runs WHERE started_ms < ? AND kind = ?')
    .bind(runsCutoff, 'collect')
    .run();
  const hourlyCutoff = now - rollups1hRetentionDays * DAY_MS;
  const hourlyRes = await db
    .prepare('DELETE FROM rollups_1h WHERE hour_ts < ?')
    .bind(hourlyCutoff)
    .run();
  const rawRows = rawRes.meta.changes;
  const runRows = runsRes.meta.changes;
  const hourlyRows = hourlyRes.meta.changes;
  await recordRun(
    db,
    dayTs,
    'prune',
    'ok',
    pruneStart,
    clock.now(),
    rawRows + runRows + hourlyRows,
    null,
  );
  safeEvent(obs, 'prune', { status: 'ok' }, { rawRows, runRows, hourlyRows });
}
