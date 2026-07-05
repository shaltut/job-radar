-- 015_add_careerjet_source.sql
-- Register Careerjet as a selectable discovery source. Careerjet is a FREE aggregator
-- search API covering the Gulf (gated on a free CAREERJET_AFFID, not an Apify token).
-- Seeds OFF / not-by-default like the other paid/optional boards (P3).
-- Append-only; idempotent; apply as `jobradar`.

INSERT INTO sources (name, market, enabled, enable_by_default) VALUES
  ('careerjet','mena', false, false)
ON CONFLICT (name) DO NOTHING;
