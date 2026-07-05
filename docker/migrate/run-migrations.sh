#!/bin/sh
# Applies engine/sql/*.sql then app/sql/*.sql, in numeric order, against the freshly-created
# `jobsearch` database — verified-safe two-phase order (see docs/JOB-RADAR.md): app migrations
# only reference tables the engine's early migrations create, none of the late engine
# migrations affect anything app/sql touches.
#
# Idempotent: every migration file uses IF NOT EXISTS / IF EXISTS / ON CONFLICT guards, so
# re-running this against an already-migrated DB is a safe no-op.
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:=5432}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${PGDATABASE:?PGDATABASE is required}"
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

echo "== waiting for postgres to accept connections =="
until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; do
  sleep 1
done

echo "== engine migrations (/migrations/engine) =="
for f in /migrations/engine/*.sql; do
  [ -e "$f" ] || continue
  echo "-- applying: $f"
  psql -v ON_ERROR_STOP=1 -f "$f"
done

echo "== app migrations (/migrations/app) =="
for f in /migrations/app/*.sql; do
  [ -e "$f" ] || continue
  echo "-- applying: $f"
  psql -v ON_ERROR_STOP=1 -f "$f"
done

echo "== migrations complete =="
