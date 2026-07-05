-- 010_add_wellfound_source.sql
-- Register Wellfound (blackfalcondata/wellfound-scraper) in the discovery toggle table.
-- Wellfound (ex-AngelList) has no free API (DataDome+Cloudflare) → paid Apify actor,
-- so it seeds OFF (P3) — runs only when toggled ON in the UI *and* APIFY_TOKEN is present.
--
-- Append-only migration (do NOT edit 007-009). Idempotent: ON CONFLICT DO NOTHING.
-- Apply as schema owner `jobradar`; jobsearch_app already has SELECT + UPDATE(enabled).

INSERT INTO sources (name, market, enabled, enable_by_default) VALUES
  ('wellfound','global', false, false)
ON CONFLICT (name) DO NOTHING;
