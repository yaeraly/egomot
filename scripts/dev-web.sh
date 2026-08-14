#!/usr/bin/env bash
# Start the Next.js app on port 3000 only. Never fall back to 3001 (that is the API).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -tlnH | grep -qE ':3000([^0-9]|$)'
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

if port_in_use; then
  echo "Port 3000 is already in use."
  echo "The web app must stay on 3000 because the API uses 3001."
  echo "Free it, then retry:"
  echo "  sudo fuser -k 3000/tcp"
  exit 1
fi

cd "$ROOT/apps/web"
exec npx next dev --port 3000 --hostname 127.0.0.1
