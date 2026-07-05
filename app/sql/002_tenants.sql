BEGIN;
CREATE TABLE IF NOT EXISTS tenants (
  id BIGSERIAL PRIMARY KEY, name TEXT, is_owner BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tenants_single_owner ON tenants (is_owner) WHERE is_owner;

ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id BIGINT REFERENCES tenants(id);
ALTER TABLE jobs  ADD COLUMN IF NOT EXISTS tenant_id BIGINT REFERENCES tenants(id);
ALTER TABLE discovery_excludes ADD COLUMN IF NOT EXISTS tenant_id BIGINT REFERENCES tenants(id);
ALTER TABLE discovery_runs     ADD COLUMN IF NOT EXISTS tenant_id BIGINT REFERENCES tenants(id);
ALTER TABLE source_previews    ADD COLUMN IF NOT EXISTS tenant_id BIGINT REFERENCES tenants(id);

-- per-tenant source enablement (sources catalog stays global)
CREATE TABLE IF NOT EXISTS tenant_source_config (
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  source_name TEXT NOT NULL REFERENCES sources(name),
  enabled BOOLEAN NOT NULL DEFAULT false,           -- new/global source = OFF for everyone
  run_interval_hours INTEGER NOT NULL DEFAULT 24,
  config JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, source_name));

-- per-user encrypted API keys (BYO-key)
CREATE TABLE IF NOT EXISTS tenant_secrets (
  tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id),
  apify_token_enc  TEXT, openai_key_enc TEXT,       -- AES-256-GCM ciphertext (iv:tag:data), nullable
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- seed owner + backfill everything to it
INSERT INTO tenants (name, is_owner) SELECT 'owner', true WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE is_owner);
UPDATE jobs  SET tenant_id=(SELECT id FROM tenants WHERE is_owner) WHERE tenant_id IS NULL;
UPDATE users SET tenant_id=(SELECT id FROM tenants WHERE is_owner) WHERE tenant_id IS NULL;
UPDATE discovery_excludes SET tenant_id=(SELECT id FROM tenants WHERE is_owner) WHERE tenant_id IS NULL;
UPDATE discovery_runs     SET tenant_id=(SELECT id FROM tenants WHERE is_owner) WHERE tenant_id IS NULL;
UPDATE source_previews    SET tenant_id=(SELECT id FROM tenants WHERE is_owner) WHERE tenant_id IS NULL;
-- seed owner's source config from the current global sources.enabled/interval
INSERT INTO tenant_source_config (tenant_id, source_name, enabled, run_interval_hours, config)
  SELECT (SELECT id FROM tenants WHERE is_owner), name, enabled, run_interval_hours, config FROM sources
  ON CONFLICT DO NOTHING;

ALTER TABLE jobs  ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL;

-- per-tenant dedupe: replace the global unique with a composite
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_dedupe_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_jobs_tenant_dedupe ON jobs (tenant_id, dedupe_hash);
CREATE INDEX IF NOT EXISTS idx_jobs_tenant_discovered ON jobs (tenant_id, discovered_at DESC);

GRANT SELECT, INSERT, UPDATE ON tenants, tenant_source_config, tenant_secrets TO jobsearch_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON discovery_excludes TO jobsearch_app;   -- if not already
GRANT USAGE, SELECT ON SEQUENCE tenants_id_seq TO jobsearch_app;
COMMIT;
-- after: SELECT id FROM tenants WHERE is_owner;  → set JOBRADAR_TENANT_ID on the engine
