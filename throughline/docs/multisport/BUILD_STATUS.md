# Multi-sport build — status & handoff

_Snapshot for continuing the run→cycling→triathlon build (esp. from a fresh
session rooted in this repo). Deadline: Peter + friends race a triathlon in
**June 2027**; they're the guinea-pig cohort → public release. Target: a usable
cohort MVP within ~1 month._

## How to pick up
Read this + `docs/multisport/` (cycling-engine-spec, load-currency-transfer-spec,
triathlon-time-optimization-spec, **triathlon-program-plan**, **swim-foundation-spec**),
then `git log --oneline -20` and `git branch`. The engine seam is
`src/engine/plan/strategy.ts` (`DisciplineStrategy`, `selectStrategy`).

## Shipped & LIVE (origin/main, deploys to throughline.badoo.net via Vercel)
- Security hardening (console API guards, OAuth `state` CSRF, athlete-write scoping).
- Health page + "About you" (DOB/sex) at `/me/[id]/health`.
- **Discipline dimension** (`run|bike`) + per-sport strategy seam.
- **Cycling engine**: FTP anchor (`ftpLogic`), Coggan power zones (`powerZonesLogic`),
  and the **power×duration workout library** (`bikeWorkoutsLogic`, Story 4). `bikeStrategy`
  resolves anchor+zones+quality sessions; `assessGoalFeasibility` still a stub (Story 6).
- **Unified load currency** = TSS-equivalent, now the CODE DEFAULT
  (`loadCurrencyFlagLogic.DEFAULT_LOAD_CURRENCY='tss'`). Escape hatch env `LOAD_CURRENCY=trimp`.
  Un-backfilled prod rows compute on the fly (`selectDailyLoad`).
- **Cross-sport transfer model** + multi-track PMC (`transferLogic`, `server/fitnessTracks`).
- Goal-tracker UX rewrite (explains the gap, two-lever honesty, working CTA).

## Next (the ~1-month sprint) — cycling & swim parallelize (disjoint files)
1. **Cycling Story 5 — generate/periodize for bike.** Generalize `generate.ts`:
   `weeklyTargetMeters`→`weeklyTargetTss`, `PlannedDay.distanceMeters`→a duration/power
   payload; thread `PowerZones` (from `bikeStrategy.resolveZones`); per-day TSS→duration
   (`duration = TSS/(IF²·100)·3600`); add cycling `longRideSegments` (Z2 + embedded
   sweet-spot). Currently `generatePlan(discipline:'bike')` throws `expected power zones`.
2. **Swim leg** — "one wire + plumbing": add `'swim'` to `Discipline` (`types.ts:43`;
   `transferLogic` already has it) + `selectStrategy` case; `swimConfig` jsonb + `cssLogic`
   (Wakayoshi 400/200 → CSS), `swimZonesLogic`, swim workout library, `swimStrategy`.
   `stss()`/swim dispatch/`cssMetersPerSec` already exist in `loadCurrencyLogic` — just
   needs a CSS source. See `swim-foundation-spec.md`.
3. **Triathlon**: multi-sport plan structure + the **time-budget allocator** (manual budget
   → floors-first swim/bike/run distribution, reusing transfer model), brick sessions.
4. **UI/onboarding** for the cohort: set a tri goal + 3 anchors + budget; portal renders a
   multi-sport week. `SegmentList`/`PortalSegment` need a cycling headline branch
   (`5 × 8 min @ 228–263 W`) + the `recovery_spin` role.
5. **G1 test**: set up the 4 real accounts on live data, fix what's wrong.

Defer to post-race (per program plan gates G2/G3): cohort-percentile limiter analysis,
automatic time-budget inference, self-serve cold-start onboarding, UI polish.

## Gotchas
- **Tailwind slate scale is INVERTED** — use `text-white/80` for body copy on dark cards.
- **PGlite dev DB is single-process** — never run DB scripts while the dev server runs.
- **Never touch prod**: prod Neon `DATABASE_URL` is off-limits to agents; prod DB ops
  (backfill, migrations-on-deploy handled by `vercel-build`) are Peter's. Migrations are
  additive; `drizzle-kit generate` with `DATABASE_URL=''` is codegen-only.
- Every story stays **runner-neutral** (running output byte-identical) + additive migrations.
- Open follow-up: recalibrate the `form` TSB thresholds (+5/−10 in `server/fitness.ts`)
  from a real prod diff (`scripts/load-currency-diff.ts`) now that TSS is default.
- **Worktree parallelism** works when the session runs from THIS repo — run cycling &
  swim agents concurrently (disjoint files).
