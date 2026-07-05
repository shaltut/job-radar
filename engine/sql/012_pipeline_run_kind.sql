-- 012_pipeline_run_kind.sql
-- Generalize discovery_runs into a pipeline run-queue: the same queue + poller now
-- drives discover / score / tailor on demand (the finance jobs page gets score + tailor
-- buttons alongside the discovery button). Append-only; apply as `jobradar`.

ALTER TABLE discovery_runs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'discover'; -- discover | score | tailor
ALTER TABLE discovery_runs ADD COLUMN IF NOT EXISTS note TEXT;                              -- human summary (e.g. "scored 41")
CREATE INDEX IF NOT EXISTS idx_discovery_runs_kind_status ON discovery_runs(kind, status);

-- Finance may now also set `kind` on INSERT (still INSERT-only on these two columns;
-- everything else uses defaults; the host poller does the UPDATEs as owner).
GRANT INSERT (source, kind) ON discovery_runs TO jobsearch_app;
