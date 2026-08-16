# Multi-sport build — status & handoff

_Snapshot for continuing the run→cycling→triathlon build (esp. from a fresh
session rooted in this repo). Deadline: Peter + friends race a triathlon in
**June 2027**; they're the guinea-pig cohort → public release. Target: a usable
cohort MVP within ~1 month._

## Progress (updated as we go)
- **All three legs now GENERATE weekly plans** and are LIVE: run (existing), bike (FTP/power, Story 5), swim (CSS/metres). Unified TSS currency throughout. Migrations through `0029`.
- **Decisions locked (Peter):** race = **70.3 / half-iron** (June 2027); training budget expressed as **hours/week**; limiter = **self-reported** for the guinea-pig phase.
- **DONE + LIVE:** tri time-budget allocator (`triAllocatorLogic`/`triPlan`/`server/triSeason` — hours→per-sport TSS, 70.3-weighted, composes a multi-sport week + weekly brick) and session-rendering UI (bike watts / swim pace/technique in `SegmentList` + coach `athletes/[id]`). Engine + composition + coach-view rendering complete.
- **Athlete portal multi-sport view — DONE** (branch `feat/portal-multisport`, PR #1):
  - _Increment 1_ (committed f08c687): rest-day gate + "today" copy made discipline-aware
    (bike→durationSeconds, swim→metres); `discipline`/duration/power added to `PortalSession`;
    `nextStepLogic` generalized. A bike/swim day no longer disappears as "rest."
  - _Increment 2_ (this branch): `getAthletePortal` now fetches **all** published plans overlapping
    the week (was `.limit(1)`) and exposes `todaySessions: PortalSession[]`; the portal renders a
    triathlete's day as a **stacked multi-sport card** (`components/TodayStack.tsx` — swim→bike→run,
    brick-marked) while single-sport athletes keep the focal `NextStepBanner` byte-identical.
- **REMAINING for the usable cohort MVP:**
  1. **Onboarding** — collect race distance (`TriDistance`), weekly **hours**, self-reported **limiter**, 3 anchors (VDOT/FTP/CSS) → call `setupTriSeason` (it throws naming any missing anchor). Extended in the goal-time spec's **G9** to also collect target finish time + `WeekSchedule`.
  2. **G1 test** — set up the 4 real athletes, generate, fix on live data.

## Next major design: goal-time + real-world schedule (spec written 2026-08-14)
`docs/multisport/triathlon-goal-time-and-schedule-spec.md` — the sequel to the volume allocator.
Turns a **target FINISH time** + **real-world schedule constraints** into a coordinated per-sport plan,
reusing the anchor→zones→target machinery unchanged. Three orthogonal layers on one `generateWeek`:
(1) **goal-time decomposition** — finish − transitions → moving budget → strength-relative split (each
leg predicted from the athlete's own VDOT/FTP/CSS, scaled by a single factor `k`) → per-leg race-pace
targets + required anchors; (2) **feasibility aggregate** — 3× `assessGoalFeasibility` (fills the existing
bike/swim stubs), binding-leg verdict, honest realistic finish; (3) **schedule** — `DayBudget`
(pool-access days, long day, per-day minutes) + deterministic `layoutTriWeek` greedy placement (brick on
the long day). Every layer degrades to today's behaviour when its input is absent (additive, runner-neutral).
Sequenced as **stories G1–G9** (~23–30 dev-days); goal-time chain G1→G2→G3→G4→G7→G8 is the spine,
schedule **G5 parallelizes** as a worktree. New pure modules: `triGoalTimeLogic`, `triFeasibilityLogic`,
`triScheduleLogic`, `triGoalTrackerLogic`. Biggest cohort-calibration target: bike physics (`CdA`/`Crr`).
- **Tuning (with cohort data):** hours→TSS `TYPICAL_WEEKLY_IF`, `RUN_TRAINING_PACE_RATIO`, 70.3 `RACE_DEMAND_WEIGHT`, `DEFAULT_LIMITER_BOOST`, floors — all in `triAllocatorLogic.ts`, flagged as tunable.

## Goal-time + schedule + ceiling + onboarding — DONE on `feat/tri-goal-time`
The full "target finish → per-sport targets → is it realistic → which leg binds →
lay it on my real week" arc, plus self-service onboarding. Spec:
`docs/multisport/triathlon-goal-time-and-schedule-spec.md`. All pure logic tested
(~110 new tests), run byte-identical, additive (each layer degrades to today's
behaviour when its input is absent). Stories:
- **G1/G2** `triGoalTimeLogic.ts` — leg-time predictors (swim CSS·frac; bike
  Martin-1998 power model watts↔speed; run Daniels×brick) + `decomposeGoalTime`
  (finish − transitions → moving budget → strength-relative split → per-leg
  race targets + required anchors; scaleFactor k = headline feasibility signal).
- **G3/G4** `triFeasibilityLogic.ts` — unit-agnostic `assessAnchorFeasibility`
  core (reuses run's model; run untouched) + FTP/CSS gain curves +
  `assessTriFeasibility` (binding-leg verdict, realistic finish = Σ projected
  legs + transitions).
- **Attainability ceiling** `attainabilityLogic.ts` — separates HARD from
  IMPOSSIBLE: age-grade decline (bounding box) + current + recency-discounted
  PBs (proven level) + age-damped headroom → ceiling. Above ceiling =
  `beyond_reach` verdict (new). Gain rate also scales by weekly HOURS. Three
  honest tiers: on-track / a longer game / beyond reach. Prose is kind (frames
  the TIME as elite, never the athlete).
- **G5 + G7b** `triScheduleLogic.ts` — `DayBudget`/`WeekSchedule` +
  `layoutTriWeek` (pool-only-on-pool-days, long/brick on the long day, no
  hard-stack, graceful drop) + `relayTriPlanToSchedule` (rewrites the PERSISTED
  per-sport days, not just the view).
- **G6** brick T2 transition surfaced on the persisted run session ("run off
  the bike").
- **G7/G7a** `buildTriPlan` + `setupTriSeason` thread goalFinishSeconds +
  schedule + age (DOB) + hours; persist the timed goal (`races.targetTimeSeconds`,
  `goalType:'time'` — no migration).
- **G8** portal tracker `server/triGoalTracker.ts` + `components/TriGoalTrackerHero.tsx`
  (per-leg bars, binding-leg = limiter, target vs realistic finish).
- **G9** onboarding: `/me/[id]/tri-setup` (`TriGoalSetup` + `athleteTriGoal.ts` +
  `POST /api/athletes/[id]/tri-goal`) — collects 3 anchors, target, hours,
  limiter, DOB, weekly schedule → builds + publishes → shows the verdict inline.

**Still open:** PB collection in onboarding (ceiling runs on age+current today);
cohort/Heather calibration of the ceiling constants (masters decline rates,
elite bounding-box refs, headroom) + the FTP/CSS gain curves; this branch and
PR #1 both touch `me/[id]/page.tsx` (small merge reconciliation).

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
