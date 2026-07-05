-- 008_add_indeed_source.sql
-- Register the Indeed source family (misceres/indeed-scraper) in the discovery
-- toggle table. Indeed is a paid, anti-bot-prone wide-net actor spanning BOTH legs
-- (global remote + per-GCC-country), so it seeds OFF (P3) — it only runs when toggled
-- ON in the UI *and* APIFY_TOKEN is present.
--
-- Append-only migration (007 is already applied; do NOT edit it). Idempotent:
-- ON CONFLICT DO NOTHING. Apply as the schema owner role `jobradar` (so the discover
-- reader can SELECT it); jobsearch_app already has SELECT + UPDATE(enabled) on `sources`
-- from 007, so no new GRANT is needed.

INSERT INTO sources (name, market, enabled, enable_by_default) VALUES
  ('indeed','global', false, false)
ON CONFLICT (name) DO NOTHING;
