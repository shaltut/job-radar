-- AI job category (16-taxonomy) + standardized eligibility (populated by the score pass). Nullable.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS eligibility_std TEXT;
GRANT SELECT (category, eligibility_std) ON jobs TO jobsearch_app;
