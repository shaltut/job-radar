#!/bin/bash
# Runs automatically on first container init (mounted into /docker-entrypoint-initdb.d/,
# executed by the official postgres image's entrypoint before anything else touches the DB).
#
# POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB (standard postgres image env vars, set from
# .env) already create the DB-owner role — that's `jobradar` in this project's convention,
# see .env.example. This script only needs to add the second, restricted role
# (`jobsearch_app`) that the web app connects as, with its own password from .env
# (JOBS_DB_PASSWORD) — both are already present in this container's environment via
# docker-compose's env_file, so no placeholder-editing or envsubst step is needed.
set -euo pipefail

: "${JOBS_DB_PASSWORD:?JOBS_DB_PASSWORD must be set in .env before first boot}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'jobsearch_app') THEN
        CREATE ROLE jobsearch_app LOGIN PASSWORD '${JOBS_DB_PASSWORD}';
      END IF;
    END
    \$\$;

    GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO jobsearch_app;
EOSQL

echo "init-roles: jobsearch_app role ready (table/column grants come from app/sql migrations)."
