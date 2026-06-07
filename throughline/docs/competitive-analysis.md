# Throughline — Competitive Analysis & Feature Gaps

_Last updated: 2026-06-07. Compiled from current product research (Runna, Garmin Coach/Run Coach, TrainingPeaks, Final Surge, Nike Run Club, Coopah, Runcoach, Strava) mapped against Throughline's actual capabilities._

---

## 1. The landscape has two centers of gravity

| Segment | What it optimizes for | Players |
|---|---|---|
| **Consumer coaching apps** | Simplicity + adherence. Give me a plan, push it to my watch, adapt it automatically. | Runna, Garmin Run Coach, NRC, Coopah, Runcoach |
| **Athlete management systems (AMS)** | Flexibility + coach control. Let a coach run a roster, build/assign workouts, analyze load. | TrainingPeaks, Final Surge |
| **Social / analytics hub** | Motivation + network effects. Everyone else syncs *into* it. | Strava (now owns Runna + The Breakaway) |

**Throughline is genuinely a hybrid of all three** — it has a real coaching engine (like Runna/Runcoach), coach-management tooling (like TP/Final Surge), and — uniquely — a *real elite human coach* (Heather) authoring the logic. That combination is the strategic position. Almost no competitor has all three: Runna/NRC/Garmin/Strava are pure algorithm; Coopah/Runcoach add human coaches but with dated UX and no transparent engine; TP/Final Surge have coaches but no adaptive engine at all.

---

## 2. Why an athlete picks a competitor over us today (the gaps)

Ranked by how often it's the *deciding* factor.

### Gap 1 — Automatic device sync (table stakes; we don't have it)
Every single competitor auto-ingests activities from Garmin / Apple Watch / COROS / Polar / Strava. Garmin and the adaptive Run Coach also pull HRV, sleep, and resting HR straight off the wrist. **Throughline today only imports manual Excel/Google Sheets logs.** No athlete will hand-key a spreadsheet when Runna syncs in one tap. Our Garmin provider is scaffolded (OAuth/webhook plumbing) but the code exchange, token refresh, and backfill are stubbed (`TODO(garmin)`), and there's no Strava/Apple path.
> This is the #1 blocker. It also feeds our best differentiator — the readiness engine is starved without real HRV/sleep data.

### Gap 2 — Structured workouts pushed to the watch
Runna, Garmin, Final Surge, and TrainingPeaks all push warmup/interval/recovery/cooldown steps to the watch with on-wrist guidance. We already model `segments` (warmup, work intervals, cooldown with pace targets) on every planned session — but there's **no export**. No `.fit` workout, no calendar (`.ics`), no Garmin/COROS push.

### Gap 3 — An athlete-facing experience (not the coach console)
We have an athlete detail page, an availability page, and check-ins — but they're framed as coach tools. Competitors give the athlete a clean "here's today's run, swipe to reschedule, tap to start" surface, plus (Runna/NRC) **audio cues mid-run**. We have no dedicated athlete portal, no mobile app, no notifications.

### Gap 4 — Surfaced load analytics (PMC / CTL-ATL-TSB)
TrainingPeaks' signature is the Performance Management Chart (fitness/fatigue/form over time). **We already compute CTL/ATL/TSB** (`src/engine/fitnessFatigue.ts`, `fitnessFatigueStates` table) — we just don't chart it. Low effort, high credibility with serious athletes.

### Gap 5 — Compliance / adherence tracking
TP and Final Surge score planned-vs-actual. We have `plannedSessions` and `activities` but don't compare them or show a compliance view.

### Gap 6 — Calendar sync, notifications, coach↔athlete messaging
- iCal/Google Calendar feed of the plan (trivial; nobody does it well).
- Push/email: "today's workout", "readiness is low — easy day", "you missed a long run".
- Messaging: Final Surge has it; **TrainingPeaks notably does NOT** (coaches fall back to WhatsApp). With Heather in the loop, a coach↔athlete thread is a natural moat.

### Gap 7 — Strength & mobility / injury-prevention content
Runna, Coopah, and TP all bundle strength + mobility sessions and cite them as the top retention driver. We have injury records and modality constraints but no prescribed strength work.

### Gap 8 — Social / motivation (Strava's moat)
Segments, kudos, leaderboards, multi-year history. **Recommendation: don't compete here.** Instead, sync *to* Strava (athletes keep their social graph there) and let us be the brain.

---

## 3. Where Throughline already WINS (double down, don't rebuild)

1. **A real elite coach in the loop.** Heather (Olympic Trials qualifier) authors the model. Runna/NRC/Garmin/Strava are pure algorithm; Coopah/Runcoach bolt on commodity coaches. "Train under an elite coach's actual methodology, at app scale" is a story none of them can tell.
2. **Transparent, explainable engine.** Readiness gives a score + the *drivers* behind it; full Daniels/VDOT pedigree with tunable %VO2max bands. Competitors are black boxes.
3. **Readiness from HRV/sleep z-scores vs the athlete's own baseline.** This is *more* sophisticated than Runna (TRIMP-only, no HRV/sleep) and is exactly what Garmin's adaptive coach does — except ours is explainable and coach-tunable.
4. **The exact gap competitors leave open.** The #1 shared complaint across Runna *and* Garmin is **paces/volume too aggressive and terrible injury handling.** We already have: readiness-gated easy days, injury records with allowed modalities, windowed directives, availability → rest, and Heather tuning paces to be humane. *This is the wedge.* Positioning: **"the coach that backs off when you need it."**
5. **Coach-editable model + append-only audit.** Global pace model + per-athlete overrides + strength bias, every override logged with a reason code. An AMS-grade control surface most consumer apps lack.

---

## 4. Recommended build order

### Tier 1 — Table stakes (without these, athletes won't switch)
- **A1. Finish Garmin sync** (code exchange, token refresh, backfill) → auto-ingest activities + HRV/sleep/RHR. Directly feeds the readiness differentiator.
- **A2. Strava OAuth ingest** — broadest reach; most athletes already push everything to Strava.
- **A3. Athlete portal** — promote the existing athlete views into a clean athlete-first surface (today / this week / reschedule / check-in / availability).

### Tier 2 — High leverage, cheap (builds on data we already have)
- **B1. PMC / fitness-fatigue chart** — surface CTL/ATL/TSB we already compute.
- **B2. Compliance view** — planned vs actual, per week.
- **B3. Structured workout export** — `.ics` calendar feed first (trivial), then `.fit`/Garmin workout push.

### Tier 3 — Differentiation & retention
- **C1. Notifications** (email/push): today's workout, low-readiness nudge, missed-session.
- **C2. Coach↔athlete messaging** (Heather touchpoint; TP's biggest hole).
- **C3. Strength & mobility sessions.**
- **C4. Race-day confidence / equivalent-performance surfacing** (we already compute equivalent performances).

### Explicitly NOT now
- Social graph / segments / leaderboards (Strava owns it — integrate, don't rebuild).
- Indoor virtual (TrainingPeaks Virtual / Zwift territory).
- Payments/billing (only once there are paying athletes).

---

## 5. One-line positioning

> **Throughline is the only endurance app that pairs a real elite coach's methodology with a transparent, readiness-aware engine — the coach that knows when to push and when to back off.** It plugs into the watch you already own and the Strava you already use, and gives your coach an AMS-grade console to steer it.
