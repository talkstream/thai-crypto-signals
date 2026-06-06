-- Catalog of tradeable markets. Surrogate `id` is permanent and never reused across
-- delist/relist (upsert keys on the unique `symbol`).
CREATE TABLE symbols (
  id INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL,
  price_scale INTEGER NOT NULL,
  quote_scale INTEGER NOT NULL,
  market_segment TEXT NOT NULL DEFAULT 'SPOT',
  status TEXT NOT NULL DEFAULT 'active',
  first_seen_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_symbols_status ON symbols (status);

-- Per-symbol, per-bucket price snapshot. *_minor are integer minor units (bound via Number,
-- exact to 2^53-1); bid/ask nullable for one-sided books; volumes kept verbatim as TEXT.
-- PRIMARY KEY gives idempotency: a duplicate tick INSERT OR IGNORE writes nothing.
CREATE TABLE ticker_snapshots (
  symbol_id INTEGER NOT NULL REFERENCES symbols (id),
  bucket_ts INTEGER NOT NULL,
  observed_ms INTEGER NOT NULL,
  last_minor INTEGER NOT NULL,
  high_minor INTEGER NOT NULL,
  low_minor INTEGER NOT NULL,
  bid_minor INTEGER,
  ask_minor INTEGER,
  price_scale_used INTEGER NOT NULL,
  base_volume TEXT NOT NULL,
  quote_volume TEXT NOT NULL,
  pct_change_bp INTEGER NOT NULL,
  ingested_ms INTEGER NOT NULL,
  PRIMARY KEY (symbol_id, bucket_ts)
) STRICT, WITHOUT ROWID;
CREATE INDEX idx_snap_bucket ON ticker_snapshots (bucket_ts);
CREATE INDEX idx_snap_symbol_time ON ticker_snapshots (symbol_id, observed_ms DESC);

-- Run ledger. The collect row is the LAST statement of the single atomic collect batch and
-- carries the terminal status directly (no two-phase claim; a D1 batch is one transaction).
CREATE TABLE collection_runs (
  bucket_ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  started_ms INTEGER NOT NULL,
  finished_ms INTEGER,
  server_ts_ms INTEGER,
  symbols_seen INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  drift_count INTEGER NOT NULL DEFAULT 0,
  scale_overflow_count INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,
  skew_ms INTEGER,
  http_status INTEGER,
  duration_ms INTEGER,
  error_detail TEXT,
  PRIMARY KEY (bucket_ts, kind)
) STRICT;
CREATE INDEX idx_runs_status ON collection_runs (status);
CREATE INDEX idx_runs_started ON collection_runs (started_ms);
