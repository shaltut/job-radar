-- discovery_countries is superseded by per-source country filters (sources.config,
-- migration 022). After filter-v2 the engine no longer reads it, and finance no
-- longer queries it (chore: remove dead discovery_countries plumbing). Safe to drop.
DROP TABLE IF EXISTS discovery_countries;
