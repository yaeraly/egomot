# Egomot — Phase 1

Business management system for an OWNER: products, Chinese suppliers, and China purchases with weight-based logistics allocation.

## Stack

- Frontend: Next.js 15 + TypeScript + Tailwind CSS
- Backend: NestJS + TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Auth: JWT (OWNER role)

## Default OWNER account

After seed:

- Email: `owner@egomot.local`
- Password: `Owner123!`

## Run locally

```bash
npm install
npm run setup
npm run dev:api    # http://localhost:3001
npm run dev:web    # http://localhost:3000
```

`npm run setup` starts Docker Postgres on **port 5433**, writes env files if missing, migrates, and seeds the OWNER.

Docker uses 5433 so it does not clash with a PostgreSQL already installed on 5432.

### Manual steps

```bash
docker compose up -d postgres
cp .env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm install
cd apps/api && npx prisma generate && npx prisma migrate deploy && npx prisma db seed
```

`apps/api/.env` must contain:

```
DATABASE_URL=postgresql://egomot:egomot@localhost:5433/egomot?schema=public
```

### Existing local PostgreSQL (no Docker)

If Postgres is already running on 5432 and you see `PrismaClientInitializationError` / `P1000`, the `egomot` user does not exist (or the password is wrong). Create it:

```bash
sudo -u postgres bash scripts/create-local-postgres.sh
```

Then set in `apps/api/.env`:

```
DATABASE_URL=postgresql://egomot:egomot@localhost:5432/egomot?schema=public
```

and run:

```bash
cd apps/api && npx prisma migrate deploy && npx prisma db seed
```

Or point `DATABASE_URL` at your own user/password/database.

### Tests

```bash
npm test
```

Purchase formulas, validation, status rules, and audit-log event creation run as Jest unit tests (no database required).
