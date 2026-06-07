import type { SignalConfigStore } from '../../domain/ports';
import type { SignalConfig } from '../../signals/config';

interface ConfigRow {
  watchlist: string;
  threshold_bp: number;
}

const SELECT = 'SELECT watchlist, threshold_bp FROM signal_config WHERE id = 1';
const UPSERT = `INSERT INTO signal_config (id, watchlist, threshold_bp, updated_ms)
  VALUES (1, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    watchlist = excluded.watchlist,
    threshold_bp = excluded.threshold_bp,
    updated_ms = excluded.updated_ms`;

/** D1-backed single-row signal config (id=1). Strongly consistent, so a UI edit applies next tick. */
export class D1SignalConfigStore implements SignalConfigStore {
  constructor(private readonly db: D1Database) {}

  async load(): Promise<SignalConfig | null> {
    const row = await this.db.prepare(SELECT).first<ConfigRow>();
    if (!row) return null;
    return {
      watchlist: row.watchlist
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      thresholdBp: row.threshold_bp,
    };
  }

  async save(config: SignalConfig, nowMs: number): Promise<void> {
    await this.db.prepare(UPSERT).bind(config.watchlist.join(','), config.thresholdBp, nowMs).run();
  }
}
