import type { BotConfigStore, SignalConfigStore } from '../../domain/ports';
import type { BotConfigState, PendingAction, SignalConfig } from '../../signals/config';

interface ConfigRow {
  watchlist: string;
  threshold_bp: number;
}
interface StateRow extends ConfigRow {
  pending: string | null;
}

const SELECT_CONFIG = 'SELECT watchlist, threshold_bp FROM signal_config WHERE id = 1';
const SELECT_STATE = 'SELECT watchlist, threshold_bp, pending FROM signal_config WHERE id = 1';
const SAVE_STATE = `INSERT INTO signal_config (id, watchlist, threshold_bp, pending, updated_ms)
  VALUES (1, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    watchlist = excluded.watchlist,
    threshold_bp = excluded.threshold_bp,
    pending = excluded.pending,
    updated_ms = excluded.updated_ms`;

function parseWatchlistColumn(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/** Defensive: only the two known markers count; anything else (incl. NULL) is idle. */
function normalizePending(p: string | null): PendingAction | null {
  return p === 'threshold' || p === 'add' ? p : null;
}

/**
 * D1-backed single-row config (id=1). The producer reads a `SignalConfig` via {@link load}; the in-bot
 * UI reads/writes the FULL row (incl. `pending`) via {@link loadState}/{@link saveState}. `saveState`
 * is one upsert that supplies every NOT-NULL column, so it creates the row if absent and never clobbers.
 */
export class D1SignalConfigStore implements SignalConfigStore, BotConfigStore {
  constructor(private readonly db: D1Database) {}

  async load(): Promise<SignalConfig | null> {
    const row = await this.db.prepare(SELECT_CONFIG).first<ConfigRow>();
    if (!row) return null;
    return { watchlist: parseWatchlistColumn(row.watchlist), thresholdBp: row.threshold_bp };
  }

  async loadState(): Promise<BotConfigState | null> {
    const row = await this.db.prepare(SELECT_STATE).first<StateRow>();
    if (!row) return null;
    return {
      watchlist: parseWatchlistColumn(row.watchlist),
      thresholdBp: row.threshold_bp,
      pending: normalizePending(row.pending),
    };
  }

  async saveState(state: BotConfigState, nowMs: number): Promise<void> {
    await this.db
      .prepare(SAVE_STATE)
      .bind(state.watchlist.join(','), state.thresholdBp, state.pending, nowMs)
      .run();
  }
}
