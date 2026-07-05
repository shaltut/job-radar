-- 011_discovery_runs.sql
-- On-demand discovery: a request queue + run history for the finance "Run discovery"
-- button. Finance (jobsearch_app) queues a request (INSERT) and reads status (SELECT);
-- the host discover-trigger timer claims requests, runs discover, and records the result
-- (UPDATE, as the schema owner `jobradar`). Append-only; apply as `jobradar`.

CREATE TABLE IF NOT EXISTS discovery_runs (
  id           BIGSERIAL PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'requested',   -- requested | running | done | error
  source       TEXT NOT NULL DEFAULT 'ui',          -- ui | timer
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  fetched      INT,
  matched      INT,
  inserted     INT,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_discovery_runs_status ON discovery_runs(status);

-- Least-privilege: the finance role may queue a request (INSERT only the `source` column;
-- everything else uses defaults) and read status. It never UPDATEs runs — the host
-- discover-trigger (role `jobradar`, table owner) does that.
GRANT SELECT, INSERT (source) ON discovery_runs TO jobsearch_app;
GRANT USAGE ON SEQUENCE discovery_runs_id_seq   TO jobsearch_app;
