# Deploying Throughline (Vercel + Neon + throughline.badoo.net)

This replaces the laptop + Cloudflare-tunnel setup with a permanent, always-on
deployment. The code already supports it: `getDb()` uses Neon (hosted Postgres)
whenever `DATABASE_URL` is set, and falls back to local PGlite otherwise.

Estimated time: ~30–45 min, most of it DNS/cert propagation waiting.

---

## 1. Database — Neon (hosted Postgres)

1. Create a free account at **https://neon.tech** → **New Project** (pick a
   region near you).
2. Copy the **connection string** (looks like
   `postgresql://USER:PASSWORD@ep-xxx.REGION.aws.neon.tech/neondb?sslmode=require`).
   This is `DATABASE_URL`. Treat it as a secret.

That's it for now — the schema gets created automatically at deploy (step 2 runs
`drizzle-kit migrate`).

---

## 2. App — Vercel

1. Create an account at **https://vercel.com** and **Add New → Project**, import
   the GitHub repo **`powder8/personalWebsite`**.
2. In the project setup:
   - **Root Directory:** `throughline`  ← important (the app is a subfolder).
   - **Framework Preset:** Next.js (auto-detected).
   - **Build command:** leave default — Vercel automatically runs the
     `vercel-build` script (`drizzle-kit migrate && next build`), so migrations
     apply to Neon on every deploy.
3. **Environment Variables** (Settings → Environment Variables, all
   environments):
   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string from step 1 |
   | `STRAVA_CLIENT_ID` | from your Strava API app (see step 5) |
   | `STRAVA_CLIENT_SECRET` | from your Strava API app |
   | `STRAVA_REDIRECT_URI` | `https://throughline.badoo.net/api/auth/strava/callback` |
   | `STRAVA_VERIFY_TOKEN` | any opaque string (e.g. `throughline`) |
4. **Production branch:** Settings → Git → set Production Branch to **`throughline`**
   (the work isn't merged to `main`). Or merge `throughline` → `main` first.
5. **Deploy.** First build creates the Neon schema and ships the app on a
   `*.vercel.app` URL. Open it to confirm it boots (the demo roster will be empty
   until step 4 copies data).

---

## 3. Domain — throughline.badoo.net (no Cloudflare needed)

1. In Vercel: Project → Settings → **Domains** → add `throughline.badoo.net`.
   Vercel shows a CNAME target (typically `cname.vercel-dns.com`).
2. At **register.com** (badoo.net's DNS), add one record:
   - Type **CNAME**, Host **`throughline`**, Value **`cname.vercel-dns.com`** (use
     whatever Vercel shows).
   - This does NOT affect your apex `badoo.net`, `www`, the `*` wildcard, or your
     Google Workspace email — a specific `throughline` CNAME just takes
     precedence over the wildcard for that one name.
3. Wait for propagation; Vercel auto-issues the HTTPS certificate. Done →
   `https://throughline.badoo.net` is live and permanent.

---

## 4. Copy existing data into Neon (preserves everything)

Your local DB (`.pgdata`) holds Heather's merged record, her season setup, all
imported activities/sleep, and the demo roster. Copy it into Neon so nothing is
lost (re-importing would not replay the merge / manual setup).

Run from `throughline/` on the machine that has `.pgdata`:

```bash
# 1) ensure the Neon schema exists (also done by the Vercel build):
DATABASE_URL="<neon-url>" npm run db:migrate

# 2) copy every table, ids preserved, idempotent:
DEST_DATABASE_URL="<neon-url>" PGLITE_DIR=.pgdata npx tsx scripts/migrate-to-neon.ts
```

It prints a per-table row count. Re-running is safe (ON CONFLICT DO NOTHING).
Refresh `https://throughline.badoo.net` — the roster and Heather's data appear.

> Alternative (fresh demo only, no real data): `DATABASE_URL="<neon-url>" npm run db:seed`.

---

## 5. Strava (turns sync/PMC/adherence into live data)

1. **https://www.strava.com/settings/api** → create an app.
2. **Authorization Callback Domain:** `throughline.badoo.net`.
3. Copy **Client ID** + **Client Secret** into the Vercel env vars (step 2.3),
   then redeploy.
4. Open `/me/<athlete-id>` → **Connect Strava**. Optional: create a push
   subscription later so new activities sync automatically (otherwise "Sync now"
   pulls on demand).

---

## 6. Retire the laptop setup

Once the Vercel URL works, stop the local supervisor + tunnel:

```bash
pkill -f keep-serving.sh
pkill -f "cloudflared tunnel"
pkill -f "next start"
```

---

## Notes / future

- **Local dev still works unchanged:** `npm run dev` with no `DATABASE_URL` uses
  PGlite. Deploy is just sharing; iterate locally, push to deploy.
- **`TODAY` is a fixed demo date** (`src/server/console.ts`). Switch it to the
  real current date when you move past the seeded demo timeline.
- **Inngest** (async Garmin normalization) isn't required for Strava — its pull
  sync normalizes inline. Wire Inngest cloud keys only when Garmin goes live.
