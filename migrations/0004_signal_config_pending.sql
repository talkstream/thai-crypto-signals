-- In-bot config UI: a transient "pending input" marker so the next text message from the operator is
-- interpreted as a custom symbol ('add') or a custom threshold ('threshold'). NULL = idle. The bot
-- writes the whole row (watchlist + threshold + pending) in one atomic upsert, so this column never
-- needs a default. signal_config is STRICT (not WITHOUT ROWID) — ADD COLUMN is safe; the seeded row
-- gets pending = NULL.
ALTER TABLE signal_config ADD COLUMN pending TEXT;
