export const DB_AUTH_HELP = `
Database connection failed.

You do not have Docker. Egomot uses the PostgreSQL already installed on this machine,
on port 5432 — not port 5433.

Fix:

1) Point apps/api/.env at local Postgres:

   DATABASE_URL=postgresql://egomot:egomot@localhost:5432/egomot?schema=public

2) Create the database user (once):

   sudo -u postgres bash scripts/create-local-postgres.sh

3) Migrate and seed:

   cd apps/api && npx prisma migrate deploy && npx prisma db seed

Or from the repo root:

   npm run setup

Then start the API on 3001 and the web app on 3000 (never let Next.js take 3001):

   npm run dev:api
   npm run dev:web

If port 3000 is busy:

   sudo fuser -k 3000/tcp
`;
