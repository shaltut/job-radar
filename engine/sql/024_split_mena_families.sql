-- Indeed & LinkedIn have a global leg AND a MENA leg. v2 makes the MENA leg its own filter
-- family (own config + country filter), so add their source rows. Idempotent.
INSERT INTO sources (name, market, enabled, enable_by_default) VALUES
  ('indeed-mena',   'mena', true, true),
  ('linkedin-mena', 'mena', true, true)
ON CONFLICT (name) DO NOTHING;
