-- AI-extracted job summary fields (populated by the score pass). Nullable; do not
-- touch the raw title/remote/location columns (those power discovery).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS clean_title TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tech_stack  TEXT[];
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS work_mode   TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS locations   TEXT[];
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS eligibility TEXT;

-- Finance reads as the least-priv role (column-level grants).
GRANT SELECT (clean_title, tech_stack, work_mode, locations, eligibility) ON jobs TO jobsearch_app;
