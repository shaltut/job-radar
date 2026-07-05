-- 020_add_hn_reddit_sources.sql
-- Register Hacker News "Who is hiring?" and Reddit r/forhire as ON-by-default
-- global free sources, like remotive/remoteok/jobicy/arbeitnow/weworkremotely/himalayas.
-- Append-only; idempotent; apply as `jobradar`.

INSERT INTO sources (name, market, enabled, enable_by_default) VALUES
  ('hackernews', 'global', true, true),
  ('reddit',     'global', true, true)
ON CONFLICT (name) DO NOTHING;
