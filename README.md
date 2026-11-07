# TNA Tracker

Warns a garment exporter early when an order is running late. Supervisors post daily floor numbers from their phones, the risk engine compares them with the plan, and buyers see progress through a private read-only link.

**Status:** the API, database and risk engine work and are tested. The web app comes next.

## Run locally

Needs Node 20 or newer and Docker.

```bash
npm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
npm run db:up
```

```bash
npm exec -w apps/api -- prisma generate
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

Set `JWT_SECRET` in `apps/api/.env` to a random value of at least 32 characters, then start the API on port 4000:

```bash
npm run dev
```

Run the tests. The integration tests need the database running, and create their own `tna_test` database:

```bash
npm test
```

```bash
npm run test:integration
```

Seeding replaces all data in the database and prints each buyer's link token once.

## Layout

| Path | What it holds |
| --- | --- |
| `apps/api/src/risk` | Risk engine: pure functions with no database access |
| `apps/api/src/auth` | Sign-in, sessions and roles |
| `apps/api/src/orders` | Order setup, TNA planning, the board and date history |
| `apps/api/src/updates` | Supervisor worklist and idempotent offline sync |
| `apps/api/src/ai` | Note classifier, its validation and the background queue |
| `apps/api/src/issues` | Merchandiser review of notes |
| `apps/api/src/buyer` | Read-only buyer access, isolated by buyer |
| `apps/api/src/uploads` | Photo and voice note storage |
| `apps/api/src/seed` | Sample orders from the brief, with assumptions labelled |
| `apps/api/prisma` | Database schema, migrations and seed script |
| `apps/api/test` | Integration tests against real Postgres |
