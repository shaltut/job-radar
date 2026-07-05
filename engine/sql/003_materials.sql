-- Phase 3: tailored résumé + cover letter materials.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cv_pdf TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cover_pdf TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS materials_status TEXT;   -- NULL | 'ready' | 'error'
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS materials_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tailor_error TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tailor_attempts INTEGER NOT NULL DEFAULT 0;
