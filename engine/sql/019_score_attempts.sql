-- H3 (overnight review): cap re-scoring of un-scoreable "poison" jobs so they aren't re-sent to
-- the model forever. Mirrors tailor_attempts (003_materials.sql) and apply_attempts (004_applied.sql).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS score_attempts INTEGER NOT NULL DEFAULT 0;
