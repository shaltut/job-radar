-- Structured USD/yearly salary (normalized from salary_range for consistent display). Nullable.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_usd_min INTEGER;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_usd_max INTEGER;
GRANT SELECT (salary_usd_min, salary_usd_max) ON jobs TO jobsearch_app;
