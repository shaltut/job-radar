-- Phase 4A: application submission tracking.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS apply_attempts INTEGER NOT NULL DEFAULT 0;
