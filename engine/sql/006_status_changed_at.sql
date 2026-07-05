-- Phase 4C: track when a job's status last changed (drives follow-up timing).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;
UPDATE jobs SET status_changed_at = coalesce(applied_at, discovered_at) WHERE status_changed_at IS NULL;
ALTER TABLE jobs ALTER COLUMN status_changed_at SET DEFAULT now();
