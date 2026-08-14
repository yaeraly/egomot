export const DB_AUTH_HELP = `
Database authentication failed.

Prisma reached PostgreSQL, but the username/password in DATABASE_URL were rejected (P1000).

This almost always means the app is talking to a PostgreSQL that is already installed
on the machine (often port 5432, user "postgres"), not the Egomot Docker database.

Fix — pick one:

1) Docker (recommended, uses port 5433 so it does not clash with local Postgres):

   npm run setup

   Then in apps/api/.env:
   DATABASE_URL=postgresql://egomot:egomot@localhost:5433/egomot?schema=public

2) Keep your existing local PostgreSQL on 5432:

   sudo -u postgres bash scripts/create-local-postgres.sh

   Then in apps/api/.env:
   DATABASE_URL=postgresql://egomot:egomot@localhost:5432/egomot?schema=public

3) Use your own Postgres user:

   DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/YOUR_DB?schema=public

   Then: cd apps/api && npx prisma migrate deploy && npx prisma db seed

If Docker Postgres was started earlier with different credentials, reset the volume:

   docker compose down -v && docker compose up -d postgres
`;
