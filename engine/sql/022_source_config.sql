-- Per-source filter values controllable from /jobs/discovery. One JSONB per source row;
-- the engine spreads it into the actor input, finance (jobsearch_app) edits it. Additive + idempotent.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';
-- Finance role already has SELECT (table) + UPDATE(enabled,updated_at); add column-level UPDATE(config).
GRANT UPDATE (config) ON sources TO jobsearch_app;
