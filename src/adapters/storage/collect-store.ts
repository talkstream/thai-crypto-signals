import type { CollectStore } from '../../domain/ports';
import type { RunRecord, TickerSnapshot } from '../../domain/types';
import { isUniqueConstraintError, minorToDb, minorToDbNullable } from './d1';

const SNAPSHOT_SQL = `INSERT OR IGNORE INTO ticker_snapshots
  (symbol_id, bucket_ts, observed_ms, last_minor, high_minor, low_minor, bid_minor, ask_minor,
   price_scale_used, base_volume, quote_volume, pct_change_bp, ingested_ms)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const RUN_COLUMNS = `(bucket_ts, kind, status, started_ms, finished_ms, server_ts_ms, symbols_seen,
   rows_inserted, rows_skipped, drift_count, scale_overflow_count, rows_written, skew_ms,
   http_status, duration_ms, error_detail)`;
const RUN_VALUES = 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

// Strict INSERT for the collect path: a duplicate (bucket_ts, kind) raises a UNIQUE constraint,
// which rolls back the WHOLE batch (D1 batch = one transaction) — so a duplicate fire writes
// nothing at all, never mixing a second fetch into an existing bucket.
const RUN_SQL_STRICT = `INSERT INTO collection_runs ${RUN_COLUMNS} ${RUN_VALUES}`;
// Tolerant INSERT for the best-effort failure ledger (never clobber an existing row).
const RUN_SQL_IGNORE = `INSERT OR IGNORE INTO collection_runs ${RUN_COLUMNS} ${RUN_VALUES}`;

export class D1CollectStore implements CollectStore {
  constructor(private readonly db: D1Database) {}

  async priorLastBySymbol(bucketTs: number): Promise<Map<number, bigint>> {
    const { results } = await this.db
      .prepare('SELECT symbol_id, last_minor FROM ticker_snapshots WHERE bucket_ts = ?')
      .bind(bucketTs)
      .all<{ symbol_id: number; last_minor: number }>();
    const map = new Map<number, bigint>();
    for (const r of results) map.set(r.symbol_id, BigInt(r.last_minor));
    return map;
  }

  private snapshotStmt(s: TickerSnapshot, ingestedMs: number): D1PreparedStatement {
    return this.db
      .prepare(SNAPSHOT_SQL)
      .bind(
        s.symbolId,
        s.bucketTs,
        s.observedMs,
        minorToDb(s.lastMinor),
        minorToDb(s.highMinor),
        minorToDb(s.lowMinor),
        minorToDbNullable(s.bidMinor),
        minorToDbNullable(s.askMinor),
        s.priceScaleUsed,
        s.baseVolume,
        s.quoteVolume,
        s.pctChangeBp,
        ingestedMs,
      );
  }

  private runStmt(sql: string, run: RunRecord): D1PreparedStatement {
    return this.db
      .prepare(sql)
      .bind(
        run.bucketTs,
        run.kind,
        run.status,
        run.startedMs,
        run.finishedMs,
        run.serverTsMs,
        run.symbolsSeen,
        run.rowsInserted,
        run.rowsSkipped,
        run.driftCount,
        run.scaleOverflowCount,
        run.rowsWritten,
        run.skewMs,
        run.httpStatus,
        run.durationMs,
        run.errorDetail,
      );
  }

  async commitCollect(snapshots: TickerSnapshot[], run: RunRecord): Promise<{ overlap: boolean }> {
    const ingestedMs = run.startedMs;
    const stmts = [
      ...snapshots.map((s) => this.snapshotStmt(s, ingestedMs)),
      this.runStmt(RUN_SQL_STRICT, run),
    ];
    try {
      await this.db.batch(stmts);
      return { overlap: false };
    } catch (e) {
      if (isUniqueConstraintError(e)) return { overlap: true }; // duplicate bucket → full rollback
      throw e;
    }
  }

  async failRun(run: RunRecord): Promise<void> {
    await this.runStmt(RUN_SQL_IGNORE, run).run();
  }
}
