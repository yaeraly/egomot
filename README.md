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

### 1. PostgreSQL

Docker:

```bash
docker compose up -d postgres
```

Or any PostgreSQL 16 instance. Create database `egomot` and user `egomot` / password `egomot`.

### 2. Environment

```bash
cp .env.example apps/api/.env
# apps/api/.env already documented in .env.example
echo "NEXT_PUBLIC_API_URL=http://localhost:3001" > apps/web/.env.local
```

### 3. Install, migrate, seed

```bash
npm install
cd apps/api && npx prisma generate && npx prisma migrate deploy && npx prisma db seed && cd ../..
```

### 4. Start API and web

```bash
npm run dev:api
```

```bash
npm run dev:web
```

- Web: http://localhost:3000
- API: http://localhost:3001

### 5. Tests

```bash
npm test
```

Purchase formulas, validation, status rules, and audit-log event creation run as Jest unit tests (no database required).
