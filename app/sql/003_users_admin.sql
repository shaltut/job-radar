BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false;
GRANT SELECT (id, email, name, disabled, created_at, tenant_id, password_hash), UPDATE (disabled) ON users TO jobsearch_app;
COMMIT;
