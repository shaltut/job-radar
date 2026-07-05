-- 021_add_freelance_sources.sql
-- Register Freelancer.com (free RSS, global), Mostaql (Apify, MENA), and
-- Upwork (Apify, global) as flag-gated sources.
-- Append-only; idempotent; apply as `jobradar`.

INSERT INTO sources (name, market, enabled, enable_by_default) VALUES
  ('freelancer', 'global', true, true),
  ('mostaql',    'mena',   true, true),
  ('upwork',     'global', true, true)
ON CONFLICT (name) DO NOTHING;
