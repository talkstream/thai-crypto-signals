import init from '../../migrations/0001_init.sql?raw';
import rollups from '../../migrations/0002_rollups.sql?raw';
import signalConfig from '../../migrations/0003_signal_config.sql?raw';

// Split a migration file into runnable statements (strip full-line `--` comments, split on `;`).
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Apply all migrations to a fresh test D1 database. */
export async function applyMigrations(db: D1Database): Promise<void> {
  for (const sql of [init, rollups, signalConfig]) {
    for (const stmt of statements(sql)) {
      await db.prepare(stmt).run();
    }
  }
}

const TABLES = [
  'ticker_snapshots',
  'collection_runs',
  'rollups_1h',
  'rollups_1d',
  'symbols',
  'signal_config',
];

/**
 * Clean schema+data reset for each test. The Workers pool isolates storage per test FILE
 * (not per `it`), so we drop and re-apply rather than relying on per-test rollback.
 */
export async function resetDb(db: D1Database): Promise<void> {
  for (const table of TABLES) await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  await applyMigrations(db);
}
