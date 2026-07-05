BEGIN;
-- Backfill any straggler row that predates tenant_id (verified live: 1 row in
-- discovery_runs, an 'auto' row from before the engine stamped tenant_id — see Task 6).
UPDATE discovery_runs SET tenant_id = (SELECT id FROM tenants WHERE is_owner) WHERE tenant_id IS NULL;

-- discovery_excludes was globally unique on term (PRIMARY KEY (term)) — each tenant now
-- has their own exclude list, so two tenants must be able to both exclude "junior".
ALTER TABLE discovery_excludes DROP CONSTRAINT discovery_excludes_pkey;
ALTER TABLE discovery_excludes ADD CONSTRAINT discovery_excludes_pkey PRIMARY KEY (tenant_id, term);

-- Fail-closed: every row must carry a tenant from here on (mirrors jobs/users in C1).
ALTER TABLE discovery_excludes ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE discovery_runs     ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE source_previews    ALTER COLUMN tenant_id SET NOT NULL;

-- jobsearch_app currently has only SELECT on discovery_runs (verified via
-- has_table_privilege) — requestDiscoveryRun() needs to INSERT the 'requested' row.
GRANT INSERT ON discovery_runs TO jobsearch_app;
COMMIT;
