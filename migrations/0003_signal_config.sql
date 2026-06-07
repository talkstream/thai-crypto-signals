-- In-bot config: a single global row (id=1) holding the live signal config that the Telegram settings
-- UI edits and the producer reads each tick. The SIGNAL_WATCHLIST / SIGNAL_PCT_THRESHOLD_BP env vars
-- now only SEED the default (used when this row is absent). STRICT, matching the other tables.
CREATE TABLE signal_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  watchlist TEXT NOT NULL,          -- comma-separated symbols, e.g. "TON_THB" (empty = all symbols)
  threshold_bp INTEGER NOT NULL,    -- a mover must move >= this many basis points (300 = 3%)
  updated_ms INTEGER NOT NULL
) STRICT;

-- Seed with the current live config so behaviour is unchanged on first deploy.
INSERT INTO signal_config (id, watchlist, threshold_bp, updated_ms) VALUES (1, 'TON_THB', 300, 0);
