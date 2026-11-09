# Nool

**Garment order delay tracker for a knitwear exporter in Tiruppur.**

Nool, the Tamil word for thread (நூல்), warns a merchandiser early when an order is running late. Supervisors post each day's output from their phones, in Tamil, even with no signal. A risk engine compares that pace with each order's time-and-action (TNA) plan, and buyers in the UK and EU follow their own orders through a private, read-only link.

| | |
| --- | --- |
| **Live app** | https://isocodelabs.vercel.app |
| **Design document** | [Nool-Technical-Design-Document.pdf](Nool-Technical-Design-Document.pdf) ([Word](Nool-Technical-Design-Document.docx)) |
| **Run, deploy and demo logins** | [deployment.md](deployment.md) |

## What it does

- **Order setup:** the TNA plan is worked back from the ex-factory date by a template, with a warning when the date is too close for the lead time.
- **Supervisor daily update:** a Tamil phone app. Counts, notes, photos and voice notes queue on the phone offline and send themselves later, never twice.
- **Order board:** most urgent first, with status colours, filters by status, buyer, unit and ship week, and each order's pace drawn as thread.
- **Delay warning:** a run-rate projection per stage and per order, explained in words, with reminders and escalations.
- **AI on supervisor notes:** Whisper writes down voice notes, and an LLM translates each note and suggests a reason category. A merchandiser reviews it, with the original beside the translation.
- **Buyer link:** each buyer sees only their own orders, and a delay only after a merchandiser confirms its reason. They can also download a weekly Excel report.
- **Date history:** every date change keeps its reason.

## Built with

| Part | Technology |
| --- | --- |
| Web | React 19, Vite, React Router, installable PWA with an IndexedDB offline queue |
| API | Node 22, Express 5, Zod, Prisma 6 |
| Database | PostgreSQL (Neon in production) |
| AI | Groq: `openai/gpt-oss-120b` for notes, `whisper-large-v3` for voice |
| Files and cache | Vercel Blob (private); Redis, optional |
| Hosting and CI/CD | Vercel; GitHub Actions tests every push and deploys `main` |

## Quick start

Needs Node 20 or newer and Docker. The full steps, settings and demo accounts are in [deployment.md](deployment.md).

```bash
npm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

Set `DATABASE_URL`, `JWT_SECRET` and `SEED_DEMO_PASSWORD` in `apps/api/.env`, then:

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

```bash
npm run dev
```

In a second terminal:

```bash
npm run dev:web
```

Open http://localhost:5173.

## Tests

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:integration
```

The integration tests run the whole API against a real PostgreSQL. They need the Docker database from `npm run db:up`, and create their own `tna_test` database.

In the app, the merchandiser's **Scenario lab** runs 42 edge cases live (a silent supervisor, a holiday in the way, a phone that loses signal, an AI that makes things up) and shows what should happen against what did.

## Repository layout

| Path | What it holds |
| --- | --- |
| `apps/api/src/risk` | Risk engine: pure functions with no database access |
| `apps/api/src/orders` | Order setup, TNA planning, the board and date history |
| `apps/api/src/updates` | Supervisor worklist, idempotent offline sync and missed days |
| `apps/api/src/ai` | Speech-to-text, the note classifier, its validation and the queue |
| `apps/api/src/issues` | Merchandiser review of notes |
| `apps/api/src/buyer` | Read-only buyer access and the weekly report, isolated by buyer |
| `apps/api/src/notifications` | Reminder rules, the job that runs them and mock WhatsApp messages |
| `apps/api/src/auth`, `uploads`, `cache` | Sessions and roles, file storage, the read cache |
| `apps/api/src/seed` | Sample orders from the brief, with assumptions labelled |
| `apps/api/prisma` | Database schema, migrations and seed script |
| `apps/api/test` | Integration tests |
| `apps/web/src/screens` | One file per screen, split by who uses it |
| `apps/web/src/offline` | The supervisor's offline queue, saved worklist and photo compression |
| `api/`, `vercel.json` | The API as one Vercel Function, and the routing |
| `.github/workflows` | CI/CD, and the 15-minute scheduled tasks |
