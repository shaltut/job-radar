-- Phase 4B: tailored application answers (7 canonical questions), stored as JSON.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS apply_answers JSONB;
