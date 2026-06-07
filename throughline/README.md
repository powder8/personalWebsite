# Throughline

AI endurance coach. Adapts training to **recovery and subjective signals** (HRV,
resting HR, sleep, soreness, mood), not just a fixed plan. V1: web-only,
runners-only, Garmin-only, invite-only — a pilot for ~5–10 athletes coached by an
elite running coach who is the product's quality bar.

This app is intentionally **cleanly extractable**: it lives in `throughline/` of
the `personalWebsite` repo but shares no code with the website. The marketing /
privacy pages stay on `badoo.net` (GitHub Pages); this product deploys separately.

See [`../BUILD_SPEC.md`](../BUILD_SPEC.md) for the full product spec.

## Two non-negotiable architecture principles

1. **The planner is deterministic and auditable.** LLMs translate natural
   language in and out; they never decide the training. All plan decisions come
   from the structured engine (rules + models) so they can be regression-tested
   against the coach's judgment.
2. **Interventions edit engine _inputs_, not _outputs_.** Coach tweaks change
   athlete state/constraints (injury, caps, availability, directives, pins) so
   replanning stays coherent. Direct session edits are allowed but must be
   **pinned** so the planner routes around them.

A corollary that shapes the data layer: **`raw_events` is append-only.** Every
inbound byte (webhook, backfill, upload) lands there verbatim and is never
mutated; everything else is derived and re-derivable by replaying it. Every coach
change is captured in `overrides` / `directives` as labeled training data.

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router), TypeScript, React 19 |
| Database | Postgres via **Neon** (serverless driver) + **Drizzle** ORM/migrations |
| Async work | **Inngest** (webhook → normalize, scheduled morning run) |
| Email | **Resend** (morning delivery) |
| Hosting | **Vercel**, deployed at `app.badoo.net` |
| Providers | Isolated behind `src/providers/<id>` — Garmin only today |

## Layout

```
src/
  app/
    api/
      webhooks/garmin/   # always-on push endpoint: verify → raw_events → enqueue
      auth/garmin/       # OAuth connect + callback (+ triggers backfill)
      inngest/           # Inngest serve endpoint
  db/
    schema.ts            # Phase 1 entities (append-only raw_events, overrides, …)
    index.ts             # Drizzle client over Neon
  inngest/
    client.ts            # Inngest client + event names
    functions.ts         # normalizeRawEvent (idempotent raw → typed signals)
  providers/
    types.ts             # the Provider interface — the only seam
    garmin/              # Garmin implementation (OAuth, webhook, normalize)
  lib/
    email.ts             # Resend morning email
    hash.ts              # payload hashing for webhook dedup
drizzle/                 # generated SQL migrations
```

## Local development

Requires Node 20+ (this repo uses nvm; run `nvm use 20`).

```bash
npm install
npm run dev                     # Next.js dev server → http://localhost:3000
```

**Zero-setup dev DB.** With no `DATABASE_URL`, the app boots a file-backed
**PGlite** (real Postgres in-process, stored in `.pgdata/`), auto-applies the
migration, and **seeds a synthetic roster** on first request — so the coach
console is clickable immediately. Delete `.pgdata/` to reseed.

For a real Neon-backed setup (required before Garmin, since webhooks need an
always-on hosted endpoint):

```bash
cp .env.example .env.local      # set DATABASE_URL to your Neon connection string
npm run db:push                 # apply schema to your Neon branch
npx inngest-cli@latest dev      # (separate terminal) local Inngest, discovers /api/inngest
```

### Importing coach training logs

Spreadsheet training logs (the coach's weekly-sheet format) import via:

```bash
# one athlete
npm run import -- --file sample-data/moira-build-2021.xlsx --name "Moira" --email moira@example.com --year 2021
# a folder of files (one .xlsx per athlete; name derived from filename)
npm run import -- --dir sample-data --year 2021
```

The parser reverses Excel's date-coercion bug (a "7-8" mileage cell stored as
`2021-07-08` → the range 7–8), parses mile ranges, infers each day's date from
the week header + day name, and best-effort-parses average paces. Every row is
written to `raw_events` (append-only) first, then a normalized `Activity` is
derived. Re-importing is idempotent.

### Coach console

- `/` — **Roster**: each athlete's today readiness + flags, sorted by
  needs-attention.
- `/athletes/[id]` — **Athlete detail**: readiness history, signal charts
  (HRV / resting HR / sleep), the current published plan week, injuries,
  notes, and recent check-ins.

### Useful scripts

- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint
- `npm run db:studio` — Drizzle Studio (browse data)

## Build status

Scaffold is green: `npm run build`, `npm run typecheck`, and `npm run lint` all
pass. The Garmin OAuth token exchange, refresh, and backfill calls are
**stubbed** (they `throw` with a clear message) pending Developer Program access —
search the code for `TODO(garmin)`. The webhook capture path (verify → append to
`raw_events` → enqueue normalization) is fully wired.

## Roadmap (per BUILD_SPEC)

- **Phase 1 — Data foundation** ✅ schema + ingestion plumbing scaffolded.
- **Phase 2 — Readiness engine v0**: per-signal z-score baselines, Banister
  fitness/fatigue, one-sentence explainable readiness, validation harness +
  coach grading (the first eval set). Tables `baselines`,
  `fitness_fatigue_states`, `readiness_assessments` are in place.
- **Phase 3 — Plan engine v0**: backward-from-race periodization, coach-authored
  adaptation rules, deterministic replan, draft → preview → publish.
- **Phase 4 — Coach console**: roster, athlete detail, state/constraints editor,
  free-text directive flow (LLM translates → structured `Directive`), plan editor
  (pins + reason codes), override log.
- **Phase 5 — Athlete delivery**: morning email + magic-link check-in micro-form.

---

## ⚠️ Phase 0.5 — Human tasks (blockers for the pilot; not code)

These gate going live and have real lead time. Track them outside the codebase:

- [ ] **Legal entity + company-domain email.** Garmin requires applying as a
      *company* with a company-domain email. `badoo.net` is personal — you'll
      need an entity and a matching email, or to apply under one. **Longest-lead
      item; start here.**
- [ ] **Public privacy policy page** on `badoo.net` — the Garmin application
      requires a link to it. (Can be a static page on the existing site.)
- [ ] **One-paragraph product description page** — the application asks for the
      use case.
- [ ] **Submit Garmin Connect Developer Program access request.** Approval
      ≈ 2 business days; you get the **evaluation environment** first, then
      production. Build against eval (`GARMIN_*` env vars) until then.
- [ ] **Provision infra**: Neon project (+ dev branch), Vercel project, Inngest
      app, Resend domain verification, and the `app.badoo.net` DNS record.
