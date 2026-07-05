-- 016_add_himalayas_source.sql
-- Register Himalayas (free, no-auth remote-worldwide JSON API) as an ON-by-default
-- global source, like remotive/remoteok/jobicy/arbeitnow/weworkremotely.
-- Append-only; idempotent; apply as `jobradar`.

INSERT INTO sources (name, market, enabled, enable_by_default) VALUES
  ('himalayas','global', true, true)
ON CONFLICT (name) DO NOTHING;
