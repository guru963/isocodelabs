# Nool

Nool, the Tamil word for thread (நூல்), warns a garment exporter early when an order is running late. Supervisors post daily floor numbers from their phones, the risk engine compares them with the plan, and buyers see progress through a private read-only link.

**Status:** the API, database, risk engine and web app work end to end, locally, and can deploy to Vercel (see below). See [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md) for who it serves and why it looks the way it does.

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

In a second terminal, start the web app on port 5173:

```bash
npm run dev:web
```

The service worker only runs in a production build. To try the app offline, build it and serve the build:

```bash
npm run build:web
```

```bash
npm run preview -w apps/web
```

Buyers open links made on the Buyer links screen. A link is shown only once, when it is created.

`npm run db:up` also starts Redis. Set `REDIS_URL` in `apps/api/.env` to use it, so repeat reads skip the database. Any write clears the saved answers, and if Redis is down the app carries on without it.

Run the tests. The integration tests need the database running, and create their own `tna_test` database:

```bash
npm test
```

```bash
npm run test:integration
```

Seeding replaces all data in the database and prints each buyer's link token once.

## Demo accounts

Seeding (`npm run db:seed`) creates these accounts. All of them share one password: the `SEED_DEMO_PASSWORD` set in `apps/api/.env` when the database was seeded, or `demo1234` if it was left empty. The password is never written in this repository.

| Who | Email | Sees | Language |
| --- | --- | --- | --- |
| Priya, merchandiser | `priya@companya.example` | Order board, runway, new orders, notes to review, buyer links | English |
| Murugan, supervisor | `murugan@companya.example` | Today's counts for Unit 1 | Tamil |
| Selvi, supervisor | `selvi@companya.example` | Today's counts for Unit 2 | Tamil |
| Kumar, supervisor | `kumar@companya.example` | Today's counts for Unit 3 | Tamil |
| Lakshmi, supervisor | `lakshmi@printpartner.example` | Today's counts for the printing partner | Tamil |

Supervisors belong to a unit, not an order: each sees every open order with a stage in their unit. The washing partner has no supervisor in the sample data, so a stage sent there cannot be reported.

Buyers do not sign in. Their links come from the Buyer links screen, or from the tokens the seed prints once, and open at `/buyer#<token>`. The sample buyers are Company B (UK) and Company C (Germany).

The deployed app uses the same Neon database, so these accounts work there too. Anyone with the password can sign in, so change `SEED_DEMO_PASSWORD` and reseed before sharing the live address with anyone outside the team. Reseeding replaces all data.

## Continuous integration

GitHub Actions runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml) on every push to `main` and every pull request. It has two jobs, which run side by side:

- **Typecheck, unit tests and build**: installs from the lockfile, type-checks both apps, runs the unit tests, and builds the web app. The build is kept as a `web-dist` artifact for a week.
- **Integration tests**: starts a throwaway Postgres for that run, applies the migrations from empty, and runs the integration tests against it. These tests use an in-memory cache, so they need no Redis.

A third job, **Deploy to Vercel**, runs only on `main`, only after both test jobs pass, and only once deployment is set up as below.

## Deploy to Vercel

The screens and the API both run on Vercel. The screens are static files. The API is one Vercel Function ([`api/index.mjs`](api/index.mjs), built from [`apps/api/src/vercel.ts`](apps/api/src/vercel.ts)), and [`vercel.json`](vercel.json) sends `/api/*` and `/files/*` to it. Everything is on one address, so the sign-in cookie and buyer links work as they do locally.

A function only runs while it answers a request, so the API works differently there:

| On a server | On Vercel |
| --- | --- |
| Timers read new notes with the AI and raise reminders | Each note is read straight after it is sent, finishing after the reply. GitHub Actions calls `/api/tasks/run` every 15 minutes for retries and reminders ([`tasks.yml`](.github/workflows/tasks.yml)); Vercel Cron calls it twice a day as a backup |
| Photos and voice notes go to a folder | They go to private Vercel Blob storage and are streamed back through `/files/...` |

GitHub Actions does the deploying, so Vercel's own deploy on every push is turned off in `vercel.json`. Nothing reaches production without passing the tests.

The function runs in Vercel's Singapore region (`sin1` in `vercel.json`), next to the Neon database in `ap-southeast-1`. Each request makes several database queries, so a function far from the database pays the distance on every one: in Vercel's default US region the board took seconds. If the database moves, move the region with it. Redis, if used, belongs in the same region too, such as Upstash in `ap-southeast-1`; a Redis on your own machine cannot be reached from Vercel.

### Set it up once

1. **Vercel project.** Import the GitHub repository at vercel.com/new. Keep the repository root as the root directory; `vercel.json` sets the build.
2. **Blob storage.** In the project, open Storage, create a **private** Blob store, ideally in the Singapore region next to the function, and connect it to Production. Vercel adds `BLOB_STORE_ID` and signs the function in with OIDC, so there is no token to copy. Then run the CI workflow on `main` to deploy with it. `/api/health` answers `"files": "cloud"` once it is in use.
3. **Project environment variables** (Settings, Environment Variables, Production):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon's **pooled** connection string, ending in `&pgbouncer=true&connection_limit=1` |
   | `JWT_SECRET` | A long random value, at least 32 characters |
   | `CRON_SECRET` | A random value, at least 16 characters |
   | `GROQ_API_KEY` | Your Groq key. It also writes down voice notes, with Groq's Whisper |
   | `APP_TODAY` | Leave empty for real dates; `2026-11-06` keeps the demo data meaningful |
   | `REDIS_URL` | Optional, such as an Upstash `rediss://` address |

4. **GitHub repository settings** (Settings, Secrets and variables, Actions):

   | Kind | Name | Value |
   | --- | --- | --- |
   | Secret | `VERCEL_TOKEN` | A token from vercel.com/account/tokens |
   | Secret | `DATABASE_URL_UNPOOLED` | Neon's **direct** connection string, for migrations |
   | Secret | `CRON_SECRET` | The same value as on Vercel |
   | Variable | `VERCEL_ORG_ID` | From `.vercel/project.json` after `npx vercel link`, or the project's settings |
   | Variable | `VERCEL_PROJECT_ID` | The same file or page |
   | Variable | `APP_URL` | The production address, such as `https://nool.vercel.app` |

Setting `VERCEL_PROJECT_ID` turns on the deploy job, and `APP_URL` turns on the 15-minute scheduler. The next push to `main` deploys: the tests run, the migrations are applied to Neon, the app is built and deployed, and the live `/api/health` is checked.

Uploads are limited to 4.5 MB on Vercel. Photos are already shrunk on the phone before sending, so they stay well under it.

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
| `apps/api/src/cache` | Redis read cache, cleared by every write |
| `apps/api/src/notifications` | Reminder rules, the job that runs them, and mock WhatsApp messages |
| `apps/api/src/seed` | Sample orders from the brief, with assumptions labelled |
| `apps/api/prisma` | Database schema, migrations and seed script |
| `apps/api/test` | Integration tests against real Postgres |
| `apps/web/src/screens` | One file per screen, split by who uses it |
| `apps/web/src/offline` | Supervisor update queue, saved worklist and photo compression |
| `apps/web/src/lib` | API client, session, Tamil and English strings |
