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

## Run locally (no Docker)

This is the default path. Use the PostgreSQL already installed on the machine (port 5432).

```bash
cd ~/Downloads/egomot   # or your clone path
npm install
sudo -u postgres bash scripts/create-local-postgres.sh
```

Put this in `apps/api/.env` (port **5432**, not 5433):

```
DATABASE_URL=postgresql://egomot:egomot@localhost:5432/egomot?schema=public
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=7d
OWNER_EMAIL=owner@egomot.local
OWNER_PASSWORD=Owner123!
PORT=3001
WEB_ORIGIN=http://localhost:3000
```

```bash
echo "NEXT_PUBLIC_API_URL=http://localhost:3001" > apps/web/.env.local
cd apps/api && npx prisma generate && npx prisma migrate deploy && npx prisma db seed && cd ../..
```

Start **two terminals**:

```bash
npm run dev:api    # http://localhost:3001
```

```bash
npm run dev:web    # http://localhost:3000
```

Open http://localhost:3000 (the UI). Do not open 3001 in the browser — that is the API.

If Next.js says port 3000 is in use, free it. Otherwise it will steal 3001 from the API:

```bash
sudo fuser -k 3000/tcp
npm run dev:web
```

Or from the repo root:

```bash
npm run setup
```

`setup` uses local Postgres on 5432 when Docker is not installed.

## Optional: Docker Postgres

Only if Docker is installed. Compose maps Postgres to port **5433**.

```
DATABASE_URL=postgresql://egomot:egomot@localhost:5433/egomot?schema=public
```

## Tests

```bash
npm test
```
