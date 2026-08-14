#!/usr/bin/env bash
# Start Docker Postgres, write env files if missing, migrate and seed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_ENV="$ROOT/apps/api/.env"
WEB_ENV="$ROOT/apps/web/.env.local"
DOCKER_URL="postgresql://egomot:egomot@localhost:5433/egomot?schema=public"
OLD_DEFAULT_URL="postgresql://egomot:egomot@localhost:5432/egomot"

write_api_env() {
  cat > "$API_ENV" <<EOF
DATABASE_URL=${DOCKER_URL}
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=7d
OWNER_EMAIL=owner@egomot.local
OWNER_PASSWORD=Owner123!
PORT=3001
WEB_ORIGIN=http://localhost:3000
EOF
}

if [ ! -f "$API_ENV" ]; then
  write_api_env
  echo "Wrote $API_ENV"
fi

if [ ! -f "$WEB_ENV" ]; then
  echo "NEXT_PUBLIC_API_URL=http://localhost:3001" > "$WEB_ENV"
  echo "Wrote $WEB_ENV"
fi

if command -v docker >/dev/null 2>&1; then
  echo "Starting Docker Postgres on localhost:5433..."
  docker compose up -d postgres
  echo "Waiting for Postgres to become ready..."
  ready=0
  for _ in $(seq 1 40); do
    if docker compose exec -T postgres pg_isready -U egomot -d egomot >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
  if [ "$ready" != "1" ]; then
    echo "Postgres did not become ready. Check: docker compose logs postgres"
    exit 1
  fi

  if grep -q "$OLD_DEFAULT_URL" "$API_ENV"; then
    tmp="$(mktemp)"
    sed "s|${OLD_DEFAULT_URL}|${DOCKER_URL}|" "$API_ENV" > "$tmp" && mv "$tmp" "$API_ENV"
    echo "Updated apps/api/.env to use Docker Postgres on port 5433"
  fi
else
  echo "Docker is not installed. Using DATABASE_URL from apps/api/.env"
  echo "If login fails with P1000, create the local role:"
  echo "  sudo -u postgres bash scripts/create-local-postgres.sh"
  echo "and set DATABASE_URL to port 5432."
fi

echo "Generating Prisma client, applying migrations, seeding OWNER..."
cd "$ROOT/apps/api"
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
echo
echo "Database is ready. Start the apps with:"
echo "  npm run dev:api"
echo "  npm run dev:web"
echo
echo "OWNER login: owner@egomot.local / Owner123!"
