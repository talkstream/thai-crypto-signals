-- Hourly OHLC candles, built set-based (INSERT...SELECT...GROUP BY) by the hourly cron.
-- `finalized` flips 0->1 once the window is closed and immutable.
CREATE TABLE rollups_1h (
  symbol_id INTEGER NOT NULL REFERENCES symbols (id),
  hour_ts INTEGER NOT NULL,
  open_minor INTEGER NOT NULL,
  high_minor INTEGER NOT NULL,
  low_minor INTEGER NOT NULL,
  close_minor INTEGER NOT NULL,
  price_scale_used INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  finalized INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol_id, hour_ts)
) STRICT, WITHOUT ROWID;

-- Daily OHLC candles (GMT+7 day-start; Thai daily candles). Retained indefinitely
-- (~454 rows/day, a few MB/year). Derived from rollups_1h with the same set-based logic.
CREATE TABLE rollups_1d (
  symbol_id INTEGER NOT NULL REFERENCES symbols (id),
  day_ts INTEGER NOT NULL,
  open_minor INTEGER NOT NULL,
  high_minor INTEGER NOT NULL,
  low_minor INTEGER NOT NULL,
  close_minor INTEGER NOT NULL,
  price_scale_used INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  finalized INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol_id, day_ts)
) STRICT, WITHOUT ROWID;
