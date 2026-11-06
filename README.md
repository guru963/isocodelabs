# TNA Tracker

Warns a garment exporter early when an order is running late. Supervisors post daily floor numbers from their phones, the risk engine compares them with the plan, and buyers see progress through a private read-only link.

**Status:** database schema, sample data and risk engine are in place. The API and web app come next.

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
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm test
```

Seeding replaces all data in the database and prints each buyer's link token once.

## Layout

| Path | What it holds |
| --- | --- |
| `apps/api/src/risk` | Risk engine: pure functions with no database access |
| `apps/api/src/orders` | TNA milestone planning |
| `apps/api/src/seed` | Sample orders from the brief, with assumptions labelled |
| `apps/api/prisma` | Database schema, migrations and seed script |
