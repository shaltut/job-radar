-- 017_source_runs.sql
-- Per-source discovery health: one append-only row per (discover run × source).
-- Powers pipeline health alerts (Telegram pings + digest footer) and is the data
-- seam for the future source-effectiveness analytics. Apply as `jobradar`.

CREATE TABLE IF NOT EXISTS source_runs (
  id               bigserial PRIMARY KEY,
  discovery_run_id bigint REFERENCES discovery_runs(id) ON DELETE SET NULL,
  source           text    NOT NULL,        -- concrete: 'remotive', 'bayt-uae', 'linkedin'
  family           text    NOT NULL,        -- familyOf(): 'remotive', 'bayt', 'linkedin'
  fetched          integer NOT NULL DEFAULT 0,
  matched          integer NOT NULL DEFAULT 0,
  errored          boolean NOT NULL DEFAULT false,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS source_runs_source_created_idx ON source_runs (source, created_at DESC);
CREATE INDEX IF NOT EXISTS source_runs_run_idx ON source_runs (discovery_run_id);

-- Finance (jobsearch_app) reads only — feature 2 (source-effectiveness). It never inserts.
GRANT SELECT ON source_runs TO jobsearch_app;
