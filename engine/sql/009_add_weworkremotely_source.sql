-- 009_add_weworkremotely_source.sql
-- Register WeWorkRemotely in the discovery toggle table. WWR is free + no-auth
-- (consumed via its public RSS feed — its .json routes are 406-blocked and /api is
-- the employer/partner API), so it seeds ON by default like remotive/remoteok/jobicy/
-- arbeitnow.
--
-- Append-only migration (do NOT edit 007/008). Idempotent: ON CONFLICT DO NOTHING.
-- Apply as the schema owner role `jobradar` (so the discover reader can SELECT it);
-- jobsearch_app already has SELECT + UPDATE(enabled) on `sources` from 007.

INSERT INTO sources (name, market, enabled, enable_by_default) VALUES
  ('weworkremotely','global', true, true)
ON CONFLICT (name) DO NOTHING;
