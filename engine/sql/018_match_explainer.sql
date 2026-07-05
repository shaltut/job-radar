-- 018_match_explainer.sql
-- Per-job match explainer: persist the fit signals the scorer already computes,
-- plus matched/missing skills. Powers the "Why this score?" modal + the skills-gap page.
-- Apply as `jobradar`. Idempotent. No GRANT needed: jobsearch_app has table-level SELECT.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS seniority_fit  text;   -- low | medium | high
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS domain_fit     text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS remote_fit     text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS matched_skills text[]; -- JD skills the resume evidences
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS missing_skills text[]; -- JD-required skills not in the resume
