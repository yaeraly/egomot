#!/usr/bin/env bash
# Create the egomot role + database on an existing local PostgreSQL.
# Run as a superuser, typically:
#   sudo -u postgres bash scripts/create-local-postgres.sh
set -euo pipefail

psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'egomot') THEN
    CREATE ROLE egomot LOGIN PASSWORD 'egomot' SUPERUSER;
  ELSE
    ALTER ROLE egomot WITH LOGIN PASSWORD 'egomot';
  END IF;
END
$$;

SELECT 'CREATE DATABASE egomot OWNER egomot'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'egomot')\gexec
SQL

echo "Local role and database are ready."
echo "Set apps/api/.env to:"
echo "  DATABASE_URL=postgresql://egomot:egomot@localhost:5432/egomot?schema=public"
