# Nool: deployment

- **Repository:** https://github.com/guru963/isocodelabs
- **Live app:** https://isocodelabs.vercel.app

Nool is a monorepo with two apps: `apps/api` (Node, Express, Prisma, PostgreSQL) and `apps/web` (React, Vite, installable as a phone app). Locally they run as two dev servers. In production both run on Vercel at one address.

---

## 1. Run it locally

### What you need

- Node.js 20 or newer (CI uses 22)
- Docker Desktop, for PostgreSQL and Redis
- Git
- Optional: a free Groq API key from console.groq.com, for translating notes and writing down voice notes. Without it, the app still works, and every note goes straight to a person for review.

### Steps

Run each command from the repository root.

1. Get the code and install everything:

   ```bash
   git clone https://github.com/guru963/isocodelabs.git
   ```

   ```bash
   cd isocodelabs
   ```

   ```bash
   npm install
   ```

2. Create the API settings file from the example:

   ```bash
   cp apps/api/.env.example apps/api/.env
   ```

   Open `apps/api/.env` and set:

   - `DATABASE_URL` to `postgresql://tna:tna_local_dev@localhost:5433/tna`, the Docker database from step 3
   - `JWT_SECRET` to any random text of at least 32 characters
   - `SEED_DEMO_PASSWORD` to the password the demo accounts should get
   - `GROQ_API_KEY` to your Groq key, if you have one
   - `REDIS_URL` to `redis://localhost:6379`, optional, to cache repeat reads

   Leave `APP_TODAY="2026-11-06"` as it is. It pins "today" to the date the sample orders were written for, so the board opens with one delayed, one at-risk and one on-track order.

3. Start PostgreSQL and Redis:

   ```bash
   npm run db:up
   ```

4. Create the database tables:

   ```bash
   npm exec -w apps/api -- prisma generate
   ```

   ```bash
   npm run db:migrate
   ```

5. Load the sample orders, people and buyers. This replaces all data in the database, and prints each buyer's link token once:

   ```bash
   npm run db:seed
   ```

6. Start the API on port 4000:

   ```bash
   npm run dev
   ```

7. In a second terminal, start the web app on port 5173:

   ```bash
   npm run dev:web
   ```

8. Open http://localhost:5173 and sign in with one of the demo accounts in section 3.

### Try it offline

The offline service worker only runs in a production build:

```bash
npm run build:web
```

```bash
npm run preview -w apps/web
```

Open http://localhost:5173, sign in as a supervisor, then turn off the network in the browser's developer tools. Counts entered now are kept on the device and send themselves when the network returns.

### Run the tests

```bash
npm run typecheck
```

```bash
npm test
```

The integration tests need the Docker database running. They create and migrate their own `tna_test` database, so your data is untouched:

```bash
npm run test:integration
```

---

## 2. How it is deployed

### Where it runs

| Part | Where | Notes |
| --- | --- | --- |
| Web screens | Vercel, static files | Built from `apps/web` |
| API | Vercel Function, Singapore region (`sin1`) | One function, [`api/index.mjs`](api/index.mjs), bundled from `apps/api/src/vercel.ts` |
| Database | Neon PostgreSQL, Singapore (`ap-southeast-1`) | The function is in the same region, so queries take milliseconds |
| Photos and voice notes | Vercel Blob, private store | Streamed back through the app's own `/files/...` address |
| Note translation and speech-to-text | Groq | `openai/gpt-oss-120b` for notes, `whisper-large-v3` for voice |

[`vercel.json`](vercel.json) sends `/api/*` and `/files/*` to the function and everything else to the web app. Everything shares one address, so the sign-in cookie and buyer links work the same way they do locally.

### The pipeline

GitHub Actions does all deploying. Vercel's own deploy-on-push is turned off, so nothing reaches production without passing the tests.

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request:

1. **Typecheck, unit tests and build:** installs from the lockfile, type-checks both apps, runs the unit tests and builds the web app.
2. **Integration tests:** starts a fresh PostgreSQL 17, applies every migration from empty, and runs the API against it.
3. **Deploy to Vercel:** only on `main`, and only after both jobs above pass. It does four things:
   - applies new migrations to Neon
   - builds the app with the Vercel CLI
   - deploys it
   - checks that the live `/api/health` answers

   It can also be started by hand: Actions, then CI, then Run workflow.

[`.github/workflows/tasks.yml`](.github/workflows/tasks.yml) runs every 15 minutes. A Vercel Function only runs while it answers a request, so this job calls the protected `/api/tasks/run` endpoint to do what a long-running server would do on timers:

- retry notes the AI has not read yet
- raise reminders: missed counts, notes waiting for review, orders turning delayed

Vercel Cron also calls the same endpoint twice a day, at 10:15 and 17:45 India time, as a backup. Every reminder has a unique key, so a repeated run never sends anything twice.

To check the live app from outside, open https://isocodelabs.vercel.app/api/health. It answers `{"status":"ok","files":"cloud"}` when the database is reachable and files go to Blob.

### Environment variables

Names only. Values are never stored in the repository.

**API** (`apps/api/.env` locally, Vercel project settings in production)

| Name | Needed | What it is for |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection. On Vercel, Neon's pooled address |
| `JWT_SECRET` | Yes | Signs session cookies. At least 32 characters |
| `APP_TODAY` | No | Pins "today" for the sample data. Leave empty for real dates |
| `GROQ_API_KEY` | No | Note translation, categories and voice-note transcription. Without it, notes go straight to a person |
| `AI_MODEL` | No | Groq model for notes. Default `openai/gpt-oss-120b` |
| `SPEECH_MODEL` | No | Groq Whisper model for voice notes. Default `whisper-large-v3` |
| `REDIS_URL` | No | Read cache. The app runs without it |
| `UPLOAD_DIR` | No | Local folder for photos and voice notes. Ignored on Vercel |
| `BLOB_STORE_ID` | Vercel only | Set by Vercel when a Blob store is connected. Sends files to Blob, signing in with OIDC |
| `BLOB_READ_WRITE_TOKEN` | No | Older way to reach a Blob store. Either this or `BLOB_STORE_ID` |
| `CRON_SECRET` | Vercel only | Protects `/api/tasks/run`. At least 16 characters |
| `REMINDER_TIME` | No | India time for the supervisor reminder. Default `17:30` |
| `ESCALATION_TIME` | No | India time a missing count is passed to the merchandiser. Default `10:00` |
| `SEED_DEMO_PASSWORD` | Seeding only | Password given to every demo account |
| `PORT` | No | API port locally. Default `4000` |
| `NODE_ENV` | No | `production` makes cookies secure. Vercel sets it |

**Web**

| Name | Needed | What it is for |
| --- | --- | --- |
| `API_ORIGIN` | No | Where the local dev server forwards `/api`. Default `http://localhost:4000` |

**GitHub Actions** (repository Settings, then Secrets and variables, then Actions)

| Name | Kind | What it is for |
| --- | --- | --- |
| `VERCEL_TOKEN` | Secret | Lets the pipeline deploy to Vercel |
| `DATABASE_URL_UNPOOLED` | Secret | Neon's direct address, for migrations |
| `CRON_SECRET` | Secret | Same value as on Vercel, for the 15-minute scheduler |
| `VERCEL_ORG_ID` | Variable | The Vercel team the project belongs to |
| `VERCEL_PROJECT_ID` | Variable | The Vercel project. Setting it turns the deploy job on |
| `APP_URL` | Variable | The live address. Turns on the scheduler and the post-deploy check |
| `TEST_DATABASE_URL` | Set in the workflow | The throwaway database the integration tests use |

### Set up a new deployment

1. Import the GitHub repository into Vercel, keeping the repository root as the root directory and "Other" as the framework preset. `vercel.json` sets the build.
2. In the Vercel project, create a private Blob store and connect it to Production.
3. Add the API variables above to the Vercel project.
4. Add the GitHub secrets and variables above.
5. Run the CI workflow on `main`.

---

## 3. Demo login details

Sign in at https://isocodelabs.vercel.app, or at http://localhost:5173 when running locally.

All demo accounts share one password: **`demo123`**

| Role | Name | Email | What to try |
| --- | --- | --- | --- |
| Merchandiser | Priya | `priya@companya.example` | Order board, an order's page, New order, Notes to review, Buyer links and each buyer's weekly report, and the Scenario lab |
| Supervisor, Unit 1 | Murugan | `murugan@companya.example` | Enter today's count, add a typed or spoken note, try it offline. In Tamil |
| Supervisor, Unit 2 | Selvi | `selvi@companya.example` | B-PO-88240, the order closest to its ship date |
| Supervisor, Unit 3 | Kumar | `kumar@companya.example` | The printed order's in-house stages |
| Supervisor, printing partner | Lakshmi | `lakshmi@printpartner.example` | Only the printing stage, as an outside unit |

**To see the buyer's view:** sign in as Priya, open **Buyer links**, and choose **Create link** for Company B or Company C. Open the link it shows in a private window. Buyers do not sign in, and each link shows only that buyer's orders. The buyer's page has **Download this week's report**, an Excel workbook of the same orders, their stage plans and the week's date changes. Priya can download the same file from **Weekly report** on each buyer's card.

**A suggested path through the app:**

1. As Murugan, on a phone or in a narrow window, enter a count for Stitching on B-PO-88213 and record or type a short note in Tamil.
2. As Priya, open **Notes to review**. The note shows its original text, the AI's English translation and a suggested category. Confirm it.
3. Open the buyer link for Company B. B-PO-88213 is running late, so once the note is confirmed its reason appears on that order. Before the confirmation, the buyer saw no warning.
4. Back as Priya, open B-PO-88213 and use **Change date** on a stage. The change and its reason appear in the date history, on the order page and on the buyer's page.
