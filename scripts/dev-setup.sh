#!/usr/bin/env bash
# Prepare env files, database, migrations and OWNER seed.
# Uses local PostgreSQL on 5432 when Docker is not installed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_ENV="$ROOT/apps/api/.env"
WEB_ENV="$ROOT/apps/web/.env.local"
LOCAL_URL="postgresql://egomot:egomot@localhost:5432/egomot?schema=public"
DOCKER_URL="postgresql://egomot:egomot@localhost:5433/egomot?schema=public"

write_api_env() {
  local url="$1"
  cat > "$API_ENV" <<EOF
DATABASE_URL=${url}
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=7d
OWNER_EMAIL=owner@egomot.local
OWNER_PASSWORD=Owner123!
PORT=3001
WEB_ORIGIN=http://localhost:3000
EOF
}

set_database_url() {
  local url="$1"
  if [ ! -f "$API_ENV" ]; then
    write_api_env "$url"
    echo "Wrote $API_ENV"
    return
  fi
  tmp="$(mktemp)"
  if grep -q '^DATABASE_URL=' "$API_ENV"; then
    sed "s|^DATABASE_URL=.*|DATABASE_URL=${url}|" "$API_ENV" > "$tmp" && mv "$tmp" "$API_ENV"
  else
    printf 'DATABASE_URL=%s\n' "$url" | cat - "$API_ENV" > "$tmp" && mv "$tmp" "$API_ENV"
  fi
  echo "Set DATABASE_URL in apps/api/.env"
}

if [ ! -f "$WEB_ENV" ]; then
  echo "NEXT_PUBLIC_API_URL=http://localhost:3001" > "$WEB_ENV"
  echo "Wrote $WEB_ENV"
fi

if command -v docker >/dev/null 2>&1; then
  echo "Docker found. Starting Postgres on localhost:5433..."
  docker compose up -d postgres
  echo "Waiting for Postgres..."
  ready=0
  for _ in $(seq 1 40); do
    if docker compose exec -T postgres pg_isready -U egomot -d egomot >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
  if [ "$ready" != "1" ]; then
    echo "Docker Postgres did not become ready. Check: docker compose logs postgres"
    exit 1
  fi
  set_database_url "$DOCKER_URL"
else
  echo "Docker is not installed. Using local PostgreSQL on port 5432."
  set_database_url "$LOCAL_URL"
  if command -v psql >/dev/null 2>&1 || command -v sudo >/dev/null 2>&1; then
    echo "Ensuring role and database exist (may ask for sudo)..."
    if sudo -u postgres bash "$ROOT/scripts/create-local-postgres.sh"; then
      echo "Local Postgres role/database are ready."
    else
      echo "Could not create the role automatically. Run:"
      echo "  sudo -u postgres bash scripts/create-local-postgres.sh"
    fi
  fi
fi

echo "Generating Prisma client, applying migrations, seeding OWNER..."
cd "$ROOT/apps/api"
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
echo
echo "Database is ready."
echo "  API:  npm run dev:api    -> http://localhost:3001"
echo "  Web:  npm run dev:web    -> http://localhost:3000"
echo
echo "OWNER login: owner@egomot.local / Owner123!"
echo
echo "If port 3000 is busy, free it before starting the web app:"
echo "  sudo fuser -k 3000/tcp"
