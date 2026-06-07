# Deploying Throughline

The app lives in `throughline/` inside the `personalWebsite` repo but deploys
**separately** (the static `badoo.net` site stays on GitHub Pages; this is a
Next.js app + Postgres). Target: **Vercel + Neon**.

## One-time setup

### 1. Database — Neon
1. Create a project at <https://neon.tech> (free tier is fine for the pilot).
2. Copy the **pooled** connection string → this is `DATABASE_URL`
   (looks like `postgresql://USER:PASS@ep-xxx-pooler.../neondb?sslmode=require`).

### 2. Code — already pushed
The app is on the **`throughline`** branch of `powder8/personalWebsite`.
Merge it to `main` when you want production to track it, or point Vercel at the
branch for a first look.

### 3. Vercel
1. <https://vercel.com> → **New Project** → import `powder8/personalWebsite`.
2. **Root Directory → `throughline`** (this is the key setting — it builds only
   the subfolder).
3. Framework preset: **Next.js** (auto-detected). Leave build/install defaults —
   Vercel runs the `vercel-build` script automatically, which **migrates the DB
   then builds** (`drizzle-kit migrate && next build`).
4. **Environment Variables** (Production + Preview):
   - `DATABASE_URL` — **required** (the Neon string).
   - Later, when you add integrations: `RESEND_API_KEY`, `EMAIL_FROM`,
     `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `GARMIN_*` (see `.env.example`).
5. Deploy. You get a `*.vercel.app` URL.

### 4. Demo data (optional, recommended for the first share with Heather)
A fresh DB is empty. To populate the clickable synthetic roster:
```bash
DATABASE_URL="<neon pooled url>" npm run db:seed
```
(Idempotent — safe to run once; no-ops if data exists.)

### 5. Custom subdomain (optional)
Vercel → Project → **Domains** → add `app.badoo.net`, then add the CNAME it
shows at your DNS host. The apex/`www` stays with GitHub Pages.

## Updating
Push to the tracked branch → Vercel rebuilds. `vercel-build` re-runs migrations
(idempotent), so schema changes ship with the deploy.

## Known limitation (pre-pilot follow-up)
The console's "today" is currently pinned to the seed's reference date
(`TODAY` in `src/server/console.ts`). Before running a **live** roster on real
imported data, make this dynamic (real current date, or each athlete's latest
data day). Fine for the synthetic demo; flagged so it isn't a surprise.

## Importing real athletes (after deploy)
```bash
DATABASE_URL="<neon pooled url>" npm run import -- --dir <folder-of-xlsx> --year <yyyy>
```
Imports straight into the deployed database; the console picks them up.
