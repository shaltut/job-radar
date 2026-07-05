-- Salary recommendation fields (populated by the score pass). Nullable.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_range  TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_source TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_ask    TEXT;
GRANT SELECT (salary_range, salary_source, salary_ask) ON jobs TO jobsearch_app;
