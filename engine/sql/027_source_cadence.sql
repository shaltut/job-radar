-- Per-source run cadence: a source runs at most once per run_interval_hours.
-- The scheduled (hourly) discover skips sources not yet due; manual "Run now" ignores cadence.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS run_interval_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;

-- Finance (least-priv) reads both + sets the interval; the engine (owner jobradar) records last_run_at.
GRANT SELECT (run_interval_hours, last_run_at) ON sources TO jobsearch_app;
GRANT UPDATE (run_interval_hours) ON sources TO jobsearch_app;

-- User-requested cadences (others keep the 24h default):
UPDATE sources SET run_interval_hours = 6  WHERE name = 'himalayas';
UPDATE sources SET run_interval_hours = 12 WHERE name = 'hackernews';
UPDATE sources SET run_interval_hours = 48 WHERE name = 'linkedin';
