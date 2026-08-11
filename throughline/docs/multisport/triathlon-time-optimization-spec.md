# Triathlon Time-Optimization Engine — Design Doc (`triStrategy` + `timeBudget`)

**Status:** Design + sports-science research only. No code changes. Depends on Story 0 ("discipline dimension" refactor) and the cycling engine (`bikeStrategy`, esp. the §4.4 unified-load-currency decision) landing first.
**Author:** engine design pass, 2026-08-11
**Scope:** a triathlon methodology whose organizing principle is **time optimization** — the best race result obtainable within the hours an athlete can *realistically* train. It composes the existing running engine (`src/engine/plan/*`), the in-progress cycling engine (`bikeStrategy`), and the shared PMC (`src/engine/fitnessFatigue.ts`) into a single multi-sport plan governed by a **time budget** rather than a per-discipline volume target.

---

## 0. Thesis — why "time" is the right first-class input

The running and cycling engines both periodize on a **volume scalar** (`weeklyTargetMeters` / `weeklyTargetTss`) that ramps from a start to a peak (`periodize.ts`). That model implicitly assumes the athlete *will supply* whatever volume the ramp demands. For a single-sport age-grouper that mostly holds. For a triathlete it breaks: three disciplines competing for a fixed, small, and *fluctuating* number of weekly hours is the defining constraint of the sport. The literature is blunt about this — the overwhelming majority of triathletes are time-limited amateurs, and the training-design problem is **allocation under a budget**, not maximization of volume (Friel, *The Triathlete's Training Bible*, 4th ed., ch. on "Training with limited time"; Mujika, *Endurance Training: Science and Practice*).

So this engine inverts the existing control variable. Instead of *"here is the volume ramp; find the hours,"* it is *"here are the hours you actually have; allocate them for maximum race-specific return."* Everything downstream — periodization, the workout library, the PMC — is **reused unchanged**; what we add is a layer that converts a **realistic weekly time budget** into the `weeklyTargetLoad` the existing periodizer already consumes, split across three disciplines, with an intensity distribution chosen for time-efficiency.

Central design commitment: **the plan is a function of a budget, and the budget is grounded in the athlete's completed-training history, not their aspirations.** This is the single most important idea in the doc and §1 makes it concrete.

---

## 1. Time budget as a first-class input

### 1.1 Two budgets, reconciled

We track two numbers and the tension between them:

- **`realisticWeeklyHours`** — inferred from the athlete's *actual completed* training (§1.2). This is the planning budget.
- **`targetWeeklyHours`** — what the athlete *says* they can do (intake or a slider). Aspirational; used only after reconciliation (§1.4).

The plan is built to `realisticWeeklyHours`. `targetWeeklyHours` moves the plan only to the extent history supports it. This mirrors the engine's existing "reality over aspiration" ethic — `feasibility.ts` already refuses to promise a goal the weeks can't produce, and `adaptation.ts` reads *actual* adherence (last real run from `activities`, per-day compliance) rather than the published plan. We are extending that ethic from *pace goals* to *time budgets*.

### 1.2 Inferring the realistic budget from completed history

**Source data:** `activities` (all sports), which already carries duration, `sport`, `startTime`, and `trainingLoad`. We do NOT use the *planned* sessions — planned ≠ done. We use what the athlete actually completed, exactly as `getAdaptationState` pulls the last real activity and `getComplianceWeeks` computes per-day actuals.

**Estimator (robust to noise and holidays):**

```
For each of the last N weeks (N = 8–12), sum actual training DURATION (hours), per discipline and total.
realisticWeeklyHours = trimmed/weighted central tendency of the weekly totals:
  - drop the top and bottom (a taper week and a big-camp week shouldn't set the norm),
  - exponentially weight recent weeks heavier (decay ~ the ATL/CTL spirit; recency matters),
  - use the MEDIAN as the anchor, not the mean (median resists a single monster week).
```

Rationale for median-over-mean and trimming: injury/illness/travel produce fat-tailed weekly-hours distributions; a mean is dragged by outliers in both directions. This is the same reason the readiness monitor looks at *sustained* signals (`decideRecoveryEase` over a 4–5 day window) rather than a single bad day — we want the athlete's durable capacity, not their best or worst week.

**Confidence:** attach a confidence to the estimate from the *spread* of weekly totals and the *count* of non-zero weeks. High variance or < 4 weeks of data → low confidence → lean conservative and rely more on the stated target as a prior (Bayesian-shrinkage framing: posterior budget = history-weighted-by-confidence blended with the stated prior).

**Cold start (no history):** fall back to `targetWeeklyHours` but flag it `provisional`, and re-infer after 3–4 weeks of real data. This is the training-budget analog of `LoadResult.estimated=true` in the load ladder — the number is usable but marked as a guess.

### 1.3 Day-level constraints (not just a weekly total)

A weekly-hours scalar is necessary but not sufficient. Two athletes with 8 h/week are different if one has three 2.5 h weekend windows and the other has six 80-min weekday windows. We infer, from the *day-of-week histogram of completed sessions*, a per-day availability profile:

```
DayBudget[dow] = {
  maxMinutes: number,        // longest session realistically done on this dow (p90 of history)
  typicalMinutes: number,    // median
  swimAccess: boolean,       // did swims ever land on this dow? (pool access is binary & scheduled)
  preferred: Discipline[]    // disciplines historically done on this dow
}
```

`swimAccess` matters because pool availability is a *hard, external* constraint (lane times, commute) unlike bike/run which are anywhere-anytime. The allocator (§7) must not schedule a swim on a day with no historical pool access unless the athlete overrides. The athlete can edit this profile; edits are stored like `paceConfig` overrides (athlete layer on an inferred base). Long-session days (the p90 outliers) are the *only* place bricks and long rides can live — the allocator keys off them.

### 1.4 Reconciling stated target vs. reality

When `targetWeeklyHours > realisticWeeklyHours × (1 + tolerance)`:

- Do **not** silently build the bigger plan. Surface the gap the way `assessGoalFeasibility` surfaces a pace gap: a verdict + a note. E.g. *"You're telling me 12 h/week; the last 10 weeks you've averaged 7.5 h with only two weeks above 9. I'll build to 8.5 h — a real stretch above your norm — and we ramp toward 10 if you string together three consistent weeks."*
- Build to a **bridged budget**: `min(target, realistic × rampCeiling)` where `rampCeiling` respects the ~10%/week acute-load-progression guardrail (the same conservative ramp philosophy as `periodize.ts` lerp + down-weeks; abrupt volume jumps are the dominant injury mechanism — Gabbett's acute:chronic workload ratio work, and Friel's "no more than ~10%/week" heuristic).
- Ratchet up only on *demonstrated* adherence: if the athlete consistently completes above the current budget for ~3 weeks, raise `realisticWeeklyHours`. This is a natural extension of the existing monitor loop (§8) — the same machine that eases *down* on missed days can nudge *up* on over-delivery.

**Output of §1:** a `TimeBudget { realisticWeeklyHours, targetWeeklyHours, plannedWeeklyHours, confidence, dayBudgets: DayBudget[7], provisional }`. This is the new first-class engine input.

---

## 2. Limiter analysis — the athlete's weakest link *relative to the race*

"Limiter" is Friel's central diagnostic concept: not your weakest discipline in the abstract, but the weakness that most costs you *in this race* (Friel, *Training Bible*, "Assessing your limiters"). Time optimization means spending marginal hours where they buy the most race-day seconds, and that is almost always the limiter.

### 2.1 What we compare

For each discipline we have a fitness anchor: **VDOT** (run, existing), **FTP / FTP-per-kg** (bike, from `bikeStrategy`), and — new — a **swim anchor: CSS (Critical Swim Speed)**, the swim analog of FTP/threshold (§2.3). We convert each to a **percentile against a race-appropriate reference cohort** (age-group, distance) so the three disciplines are comparable on one axis:

```
disciplineStrength[d] = percentile(anchor[d] | cohort(race.distance, athlete.ageSex))   ∈ [0,1]
```

The **limiter is the discipline (and, one level deeper, the physiological system) with the lowest race-weighted strength deficit** — see §2.4 for the weighting that makes it race-relative.

### 2.2 Physiological-system limiters, not just "swim/bike/run"

Within a discipline, the limiter can be a *system*, and this changes the prescription (this is where §3's return-on-time model plugs in):

| Limiter type | Signal | Prescription bias |
|---|---|---|
| **Aerobic / durability** (fades in the back half; CTL too low for race TSS) | large positive split in long efforts; event TSS demand > sustainable CTL | more Z2 volume + long bricks; the classic long-course limiter |
| **Threshold / sustainable power-pace** (FTP or vLT low vs. peers) | anchor percentile low; can't hold goal effort | sweet-spot / threshold work (§3) |
| **VO2max / top-end** (short-course; can't surge/hold high %) | poor 3–8 min power/pace vs. threshold | VO2 intervals (short-course only) |
| **Skill / economy** (esp. swim; disproportionate time loss for the fitness) | swim split percentile ≪ bike/run percentile; high stroke count | technique volume + frequency floor (§5) |
| **Repeatability / brick fade** (run-off-bike collapse) | run pace off the bike ≫ open-run pace | bricks (§6) |

Swim is *structurally* the most common skill-limiter in adult-onset triathletes and, simultaneously, the discipline where raw fitness converts worst into time — which is exactly why the race-demand weighting (§4) and the minimum-effective-dose floor (§5) treat it specially.

### 2.3 Swim anchor (new): Critical Swim Speed

The engine has no swim discipline yet. CSS is the cleanest swim analog to VDOT/FTP and fits the existing "one scalar → zones" strategy shape:

```
CSS (m/s) = (400 - 200) / (T400 - T200)     — Ginn 1993; Wakayoshi et al. 1992 (critical velocity)
```

from a 400 m and a 200 m time trial. CSS anchors swim pace zones (per-100 m bands around CSS pace), exactly as threshold pace anchors run zones and FTP anchors power zones. Swim load uses a CSS-based sTSS (`sTSS = (duration × IF²) × 100`, IF = swim speed / CSS), the swim rung of the unified currency (§7.4). This is a direct instance of the `DisciplineStrategy` seam: `swimStrategy.resolveFitnessAnchor → CSS`, `resolveZones → per-100 bands`.

### 2.4 How the limiter drives allocation

Two competing pulls, and the allocator balances them (§7):

1. **Fix the limiter** — marginal hours to the weakest race-weighted discipline yield the most seconds (highest return-on-time, §3).
2. **Defend the strength** — a discipline you're strong in still needs a *maintenance* floor (§5) or it decays (CTL/skill loss). You don't abandon your bike strength to fix your swim; you defend the bike cheaply and invest the surplus in the swim.

Concretely, the limiter analysis produces a **priority vector** `limiterWeight[d]` that biases allocation toward deficits, clamped by (a) race-demand weights (§4) and (b) minimum-effective-dose floors (§5). A strong swimmer / weak runner doing a 70.3 gets run-biased allocation; a weak swimmer whose swim is "only" 10% of race time still gets a technique floor but not the lion's share of hours, because the return-on-time there is capped by the race's structure (§4).

---

## 3. Return-on-time model — marginal fitness per hour

This is the economic core: for a time-limited athlete, every session type has a **marginal fitness yield per hour** and a **recovery cost per hour**, and we allocate to maximize yield subject to a recovery budget. The relevant science is the volume-vs-intensity trade-off.

### 3.1 The two-regime picture

- **High-volume, mostly-low-intensity ("polarized," ~80/20)** is the training distribution of elite endurance athletes across sports: ~80% of sessions below the first lactate/ventilatory threshold, ~20% hard, very little in the "gray zone" between (Seiler & Kjerland 2006; Seiler 2010, *"What is best practice for training intensity and duration distribution in endurance athletes?"*; Stöggl & Sperlich 2014). It works because low-intensity volume builds the aerobic base (CTL, mitochondrial/capillary adaptations) at **low recovery cost per hour**, so you can accumulate a lot of it.
- **Sweet-spot / threshold-heavy** concentrates work at ~88–95% of threshold — the **highest aerobic adaptation per *hour*** but a **higher recovery cost per hour**. For an athlete with *lots* of hours, polarized wins (they can afford the volume and the gray zone would just add fatigue without proportional benefit). For an athlete with *few* hours, the calculus flips: they cannot accumulate enough Z2 volume for volume to be the driver, so **concentrating limited hours at higher intensity extracts more fitness per available hour** — this is the explicit rationale behind sweet-spot training for time-crunched cyclists (Coggan/TrainingPeaks; the cycling spec's `sweetspot` band, 88–94% FTP, "max aerobic return per fatigue").

### 3.2 The design rule (intensity scales *down* as available hours scale *up*)

```
Let h = plannedWeeklyHours (§1).
Intensity share (fraction of load that is threshold-or-above) is a DECREASING function of h:
  - very time-limited (h low)      → threshold/sweet-spot-heavy, ~ 30–40% of load hard ("pyramidal/threshold")
  - moderate hours                 → ~ 20–25% hard (drifting toward classic 80/20)
  - high hours (rare for AGers)    → polarized 80/20, hard capped ~ 20%
```

This is *not* "more intensity is always better." It is bounded by recovery (below). The key published intuition: time-crunched athletes get more return from raising *intensity* than from chasing volume they don't have, up to the point where recovery caps them — and *masters/older athletes tolerate less high-intensity volume*, so the cap tightens with age (Seiler; Friel *Fast After 50*).

### 3.3 The recovery cost that bounds it (why we can't just make everything hard)

Every hard hour costs disproportionately more recovery than an easy hour, and recovery is the *actual* scarce resource for a time-limited athlete (they're often also time-limited on sleep). Two guardrails, both already expressible in the existing machinery:

1. **PMC / TSB guardrail.** The shared `computeFitnessFatigue` (CTL/ATL/TSB) already models fatigue accumulation. The allocator caps the week's intensity so projected **TSB doesn't dive below a floor** (chronic negative form → non-functional overreaching). ATL (7-day) rising far above CTL (42-day) is the quantitative "too much too fast" signal; the ramp guardrail (§1.4) and the existing `decideRecoveryEase` monitor already act on it.
2. **Per-discipline recovery weighting.** Running's eccentric load has the highest injury/recovery cost per hour; cycling the lowest; swimming is low-impact but shoulder-loading. So the return-on-time model is **discipline-specific**: an hour of run intensity costs more (recovery + injury risk) than an hour of bike intensity of equal TSS. This directly informs §4 (why bike absorbs intensity well) and §5 (why we protect against run overload).

### 3.4 Return-on-time table (the allocator's coefficients)

The allocator needs concrete `yieldPerHour` and `recoveryCostPerHour` per (discipline × session type). These are **tunable config layered global→athlete**, exactly like `GlobalPaceModel`. Illustrative starting values (fitness yield in "CTL-equivalent per hour," recovery cost as a multiplier):

| Discipline × session | Fitness yield/hr | Recovery cost/hr | Notes |
|---|---|---|---|
| Bike sweet-spot / threshold | high | medium | best raw aerobic return per hour; low injury risk → the time-crunched workhorse |
| Bike Z2 endurance | medium | low | cheap CTL; needs volume to matter |
| Run threshold/tempo | high | **high** | big return but highest recovery/injury cost — dose carefully |
| Run Z2 easy | medium | medium | durability + economy; impact cost is real |
| Swim technique/CSS | low fitness, **high skill** | low | fitness return per hour is poor; *time-return* can be high if swim is the limiter (skill unlocks "free" speed) |
| Brick (bike→run) | medium+ (specificity) | medium-high | race-specific transferable fitness (§6) |
| VO2 (bike or run) | high (short-course) | very high | only when top-end is the limiter and hours allow the recovery |

The crucial asymmetry: **swim's fitness-yield-per-hour is low, but its time-yield-per-hour can be high when technique is the limiter** — a stroke fix converts to seconds with almost no fitness cost. So swim is governed by a *floor* (§5), not by the fitness-yield economics that govern bike/run.

---

## 4. Race-demand weighting — allocate by where time is won and lost

The race's own structure dictates the *baseline* allocation before limiters/floors adjust it. Two things matter: **how the race's time is distributed across disciplines**, and **where seconds are actually won or lost** (which is not the same thing).

### 4.1 Published split distributions (share of total race time)

Approximate mid-pack age-group time distributions (well-documented across race-result datasets and coaching literature; e.g. TrainingPeaks / Friel course-time breakdowns, published finisher-split analyses):

| Distance | Swim | Bike | Run | Notes |
|---|---|---|---|---|
| **Sprint** (750/20/5) | ~15% | ~50% | ~35% | short; skill & transitions matter proportionally more |
| **Olympic** (1500/40/10) | ~15–18% | ~50% | ~30–33% | bike still dominant clock-time |
| **70.3** (1.9/90/21.1) | ~10% | ~50–55% | ~35–40% | long-course: **bike is ~half the day** |
| **Ironman** (3.8/180/42.2) | ~10% | ~50–55% | ~35–40% | durability event; run is where it "unravels" |

The consistent headline: **swim is the smallest time slice (~10–18%) and shrinks with distance; the bike is ~half the clock at every distance.** Naively you'd pour hours into the bike. But time *share* ≠ time *leverage*.

### 4.2 Where seconds are actually won/lost (leverage ≠ share)

- **Swim** is a small share *and* low-leverage for *fitness* (huge fitness gains buy few seconds because it's 10–15% of the day), BUT it has an outsized **indirect** effect: a bad swim costs *fresh-ness* for the bike/run far beyond the seconds lost in the water. So the swim's job in long course is "arrive out of the water cheap and fresh," which is a **skill/efficiency** target, not a fitness target — reinforcing the §5 floor logic.
- **Bike** is the biggest *investable* block: it's half the clock, it absorbs intensity with low injury cost (§3.3), and bike fitness *transfers* to the run via durability. For a time-limited long-course athlete, **the bike is usually the highest-return place to spend marginal aerobic hours** — you're strengthening ~50% of the race in the lowest-recovery-cost discipline.
- **Run** is where long-course races are *lost* (the classic Ironman "the race starts at the marathon"). Run *durability off the bike* (bricks, §6) has leverage far above the run's raw time share because that's where mid-pack athletes hemorrhage time.

### 4.3 How the weighting shifts by distance

```
Baseline discipline allocation weight ≈ f(timeShare, leverage, recoveryCostPerHour):
  Sprint/Olympic: intensity-biased across all three; swim skill + high-end run/bike matter;
                  transitions & top-end are a meaningful fraction of a short clock.
  70.3/Ironman:   volume-and-durability-biased; bike hours dominate the *investment*;
                  run allocation emphasizes brick durability over raw run volume;
                  swim held at its efficiency floor.
```

The engine expresses this as a **`raceDemandWeight[discipline][distance]`** table (tunable config) that the allocator multiplies against the limiter vector. The distance also sets the **intensity distribution prior** (§3): short-course tolerates and rewards more high-end work; long-course tilts toward threshold/sweet-spot and Z2 durability because the race itself is a sub-threshold effort — you train the system the race actually stresses (specificity; Friel, "train the demands of the event").

---

## 5. Minimum effective dose per discipline — the floors

Even a non-priority discipline needs a floor to preserve **skill, feel, and neuromuscular pattern** — decay is fastest exactly where skill matters most.

### 5.1 Why floors, and where they bite hardest

- **Swim (the sharp case):** swim performance is dominated by *technique/feel for the water*, which decays within days of not swimming and is expensive to rebuild. The evidence-based lever is **frequency over duration** — 3 × 30 min beats 1 × 90 min for skill retention, because feel is a high-frequency, low-dose adaptation. So the swim floor is expressed as a **sessions-per-week minimum (frequency), not an hours minimum.** Even when swim is a strong athlete's *least* limiting discipline, dropping below ~2 swims/week loses feel and costs more later than the maintenance would have. Time-crunched masters coaching consensus (and Friel) put the maintenance floor at **~2 swims/week, technique-focused**, rising to 3 when swim is the limiter.
- **Bike:** aerobic/CTL-driven, decays slowly; the floor is about not letting CTL erode below what the event TSS demands. Fewer, longer sessions are fine. Floor ≈ 1–2 rides/week including one that touches the long-ride duration.
- **Run:** durability and impact-tolerance decay faster than aerobic fitness, and *ramping run back up* carries the highest injury risk (this is exactly what `adaptation.ts`'s ease-back protects against). So the run floor protects **impact adaptation**: keep ~2 runs/week even in a bike-block, so you never have to rebuild run durability from cold (which is where injuries happen).

### 5.2 Floor as a constraint, not a target

Floors are *lower bounds* the allocator (§7) must satisfy before it spends the remaining budget on limiters. They also protect against the failure mode of a naive optimizer: "swim yields little fitness/hour → allocate ~0 to swim" would be technically load-optimal and race-catastrophic. The floor encodes the coaching knowledge the raw economics miss. Formally: **the allocation is a constrained optimization where the floors are hard constraints and the limiter/return-on-time terms optimize the surplus** (§7).

### 5.3 Frequency vs. volume split of the floor

Each floor is a pair: `{ minSessionsPerWeek, minLoadPerWeek }`. Swim's binding constraint is `minSessionsPerWeek` (feel); bike's is `minLoadPerWeek` (CTL); run's is a blend (both impact frequency *and* enough easy volume for durability). The `DayBudget.swimAccess` (§1.3) interacts here: if the athlete only has pool access twice a week, the swim floor is *frequency-capped by access*, and the coach note flags it.

---

## 6. Bricks & combined-session efficiency

Bricks (bike→run, occasionally swim→bike) are the highest-specificity sessions and are *doubly* valuable to a time-limited athlete: they build the exact race-day adaptation *and* they pack two disciplines into one warm-up/commute/shower overhead.

### 6.1 Why bricks earn their place under a time budget

- **Specificity:** running off the bike is a distinct neuromuscular/physiological state ("jelly legs" — altered gait, shifted fuel use, cardiac drift). It's trainable and it's exactly where mid-pack athletes lose time (§4.2). The transfer is high per hour.
- **Time efficiency:** one session's fixed overhead (change, warm-up, travel) amortized across two disciplines. For an athlete counting minutes, a 90-min brick ≈ two sessions' training effect at ~1.3 sessions' time+overhead cost.
- **Where they live:** on the `DayBudget` long-session days (the p90 windows, §1.3) — typically weekends. The allocator schedules the key brick on the longest available window and scales its structure to the race (short "transition-run" bricks for sprint/Olympic to rehearse the leg turnover; long "race-simulation" bricks for 70.3/IM to rehearse durability + fueling).

### 6.2 Combined-session patterns the allocator can emit

| Pattern | Purpose | Distance bias |
|---|---|---|
| **Transition brick** (bike + short 10–20 min run off) | rehearse the leg-turnover switch cheaply, weekly | all; primary for sprint/Oly |
| **Race-sim brick** (long bike + moderate run, race effort/fuel) | durability + pacing + nutrition | 70.3 / IM, less frequent |
| **Swim→bike** (open-water skill + ride) | OWS + T1, in-season | all, low frequency |
| **Double-day stacking** (AM easy + PM quality, same discipline) | fit volume into two short windows when one long window doesn't exist | any; a `DayBudget` fallback |

Bricks are modeled as a **multi-discipline `PlannedDay`** (see §8's schema note): one calendar day, an ordered list of discipline segments, summing to one day's load. This is a genuine extension of the current `PlannedDay` (which is single-discipline, single `distanceMeters`).

---

## 7. The allocation algorithm

This is the implementable heart. It maps **{ TimeBudget, race/goal, per-discipline fitness, limiters }** → a **weekly plan: per-discipline load + intensity distribution + a day layout**, and re-allocates as available time fluctuates. It is designed to *feed the existing periodizer*, not replace it.

### 7.1 Where it sits in the pipeline

```
TimeBudget (§1) ─┐
race/distance ───┤
per-disc fitness ┤→  ALLOCATOR  →  weeklyTargetLoad (total, in unified TSS) + split[swim,bike,run] + intensityDist
limiters (§2) ───┘                        │
                                          ▼
                        existing periodize.ts  (ramp/phases/down-weeks/taper — UNCHANGED, per-discipline)
                                          ▼
                        per-discipline generateWeek (run: existing; bike/swim: strategy) → PlannedWeek(s)
                                          ▼
                        merge into one multi-sport week honoring DayBudgets & floors
                                          ▼
                        adaptation/monitor overlay (directives) — UNCHANGED machinery
```

The allocator converts **hours → a unified weekly load target and a split**. The periodizer then does what it already does (ramp that target across the season). Critically, the allocator runs **inside the weekly loop**, so as the budget for a given week changes it re-solves — this is the re-allocation hook the proactive engine plugs into (§7.5).

### 7.2 Inputs / outputs

```ts
interface AllocationInput {
  timeBudget: TimeBudget;                 // §1 — plannedWeeklyHours + per-day windows
  race: { distance: TriDistance; date: string; priority };
  fitness: Record<Discipline, { anchor: number; percentile: number }>;  // VDOT/FTP/CSS + cohort percentile
  limiters: { weight: Record<Discipline, number>; system: LimiterSystem }; // §2
  phase: TrainingPhase;                   // from periodize.ts (base/build/peak/taper)
  floors: Record<Discipline, { minSessionsPerWeek: number; minLoadPerWeek: number }>; // §5
  returnOnTime: ReturnOnTimeModel;        // §3 tunable coefficients (global→athlete)
  raceDemandWeight: Record<Discipline, number>;  // §4, for this distance
}

interface AllocationOutput {
  weeklyTargetLoad: number;               // TOTAL, unified TSS (the periodizer's scalar)
  split: Record<Discipline, number>;      // fraction of load per discipline (Σ=1)
  intensityDist: Record<Discipline, { easyFrac; thresholdFrac; vo2Frac }>;  // §3
  dayLayout: PlannedDaySkeleton[];        // which disciplines land which day (+ bricks), honoring DayBudget
  notes: string[];                        // coach-facing rationale (the "things to think about")
}
```

### 7.3 The algorithm (heuristic-first, optimization-optional)

**Recommended v1: a constrained greedy heuristic** (deterministic, explainable, matches the engine's "same inputs → same week" ethic). An LP/QP is a *later* refinement (§7.6), not needed to ship.

```
1. BUDGET → LOAD.
   Convert plannedWeeklyHours to a total unified-TSS target using each discipline's
   expected intensity (hours × expected IF² × 100, summed). This is provisional; step 5 refines.

2. SATISFY FLOORS FIRST (hard constraints, §5).
   Reserve minLoadPerWeek and minSessionsPerWeek for each discipline. Swim's floor is
   frequency-binding and access-capped (DayBudget.swimAccess). Deduct floors from the budget.

3. ALLOCATE THE SURPLUS by return-on-time × limiter × race-demand.
   priority[d] = returnOnTime.yieldPerHour[d] × limiterWeight[d] × raceDemandWeight[d]
   Distribute remaining hours to disciplines in proportion to priority[d],
   BUT throttle each addition by recoveryCostPerHour[d] so run intensity can't dominate
   (accumulate a running "recovery budget"; stop adding hard load to a discipline when its
   marginal recovery cost would push projected weekly TSB below the floor — reuses the PMC).

4. SET INTENSITY DISTRIBUTION per discipline from plannedWeeklyHours (§3.2 curve) and phase:
   fewer hours → higher thresholdFrac; more hours → more polarized. Shift toward race-specific
   intensity in build/peak (QUALITY_EMPHASIS analog, already in generate.ts). Cap hard-load
   fraction by age/masters and by the recovery budget from step 3.

5. RECONCILE LOAD ↔ HOURS.
   Given the chosen split × intensity, recompute total TSS and check it fits the hours
   (Σ duration ≤ plannedWeeklyHours, per-day ≤ DayBudget.maxMinutes). Iterate 3–5 until
   it fits (a few passes; convex enough that greedy converges).

6. LAY OUT DAYS.
   Place long sessions / bricks on p90 DayBudget windows; swims on swimAccess days; protect
   ≥1 recovery day; avoid stacking two high-recovery-cost (run-hard) days back-to-back.
   Emit multi-discipline PlannedDays for bricks (§6). Respect the run floor's frequency for
   impact adaptation even in bike-heavy weeks.

7. EMIT weeklyTargetLoad + split + intensityDist + dayLayout + notes.
```

### 7.4 The unified load currency — the hard dependency ⚠️

The whole algorithm sums swim + bike + run into **one** `weeklyTargetLoad` and reasons about it on **one** PMC. That is only meaningful if **all three disciplines speak the same load currency**. This is the exact issue the cycling spec flagged as *"the single most important cross-discipline decision in the whole refactor"* (§4.4 there: running currently feeds the PMC Banister TRIMP, cycling produces TSS — different scales; summing them is physiologically meaningless).

**This triathlon engine cannot be correct until that decision lands, and it must land on the TSS-equivalent side.** Specifically, we require the cycling spec's **Option (A): unify on TSS-equivalent across all sports** — rTSS (run), TSS (bike), sTSS (swim, from CSS, §2.3) — so that:

- one CTL/ATL/TSB is a valid whole-athlete fitness/fatigue/form signal,
- `weeklyTargetLoad` is additive across disciplines,
- the return-on-time coefficients (§3.4) are expressed in common units.

`sTSS = IF² × hours × 100`, IF = swimSpeed/CSS, is the swim rung; it slots into the same `estimateLoad` ladder (`bikeLoad` → analog `swimLoad`). **Dependency called out explicitly:** Story 0 / cycling-Story-1 must implement unified TSS-equivalent (Option A) *before* this engine's allocator is trustworthy. Until then, the allocator can run per-discipline in parallel (three separate budgets) as a degraded mode, but the *cross-discipline* trade-off (the whole point) requires the shared currency.

### 7.5 Re-allocation as available time fluctuates (the proactive hook)

The allocator is a **pure function of the week's inputs**, so re-allocation is just re-running it with a changed `plannedWeeklyHours` / `DayBudget`. It plugs into the existing monitor/adaptation loop (`server/monitor.ts`, `adaptationLogic.ts`) as a new signal class alongside `low_recovery` and `missed_days`:

- **Time-shortfall this week** (athlete flags a busy week, or completed-hours are tracking low mid-week): re-solve with a smaller budget. The heuristic's floor-first design degrades gracefully — floors and the top-priority limiter survive; the *marginal* surplus work is what gets cut. This is far better than the naive "scale everything by 0.7," because it protects skill floors and the limiter while shedding the lowest-return hours. Emitted as a windowed `reduce_volume`-style directive, or a new `reallocate` directive carrying the new split.
- **Time-surplus** (unexpected free week): re-solve with a larger budget, adding the next-highest-priority work — but still ramp-capped (§1.4) so a windfall week doesn't spike ATL.
- **Sustained over/under-delivery**: ratchet `realisticWeeklyHours` up/down (§1.4), the budget analog of the monitor's existing ease-back, honoring the autonomous/assisted modes already in `monitor.ts` (autonomous → applied; assisted → proposed for coach approval).

Idempotency and the "clear-then-rewrite auto directives each run" pattern in `monitor.ts` carry over unchanged — the re-allocation directive is just another auto category.

### 7.6 Optimization variant (later)

The greedy heuristic maximizes `Σ priority[d]·hours[d]` under linear constraints (floors, per-day windows, total hours, recovery/TSB cap) — i.e. it's already an implicit **constrained linear/convex program**. If we later want provably optimal splits (or to trade off multiple races), formalize it as an LP/QP: maximize race-weighted projected performance subject to the same constraints. Not needed for v1; the heuristic is explainable (a real advantage for a coaching product — the athlete gets a *reason*, like the existing `rationale`/`note` strings) and deterministic.

---

## 8. Mapping onto the existing engine + build plan

### 8.1 What's reused unchanged

- **`periodize.ts`** — ramp/phases/down-weeks/taper/tune-up mini-tapers. Runs **per discipline** on that discipline's slice of `weeklyTargetLoad`. Unit-agnostic already (the cycling spec established it operates on an abstract volume scalar). No change.
- **`fitnessFatigue.ts` (PMC)** — one shared CTL/ATL/TSB over the athlete's **summed unified-TSS** across all three sports. This is the multi-sport athlete's true fitness/fatigue/form. No change *provided* §7.4 (unified currency) lands.
- **`monitor.ts` / `adaptation.ts` / `adaptationLogic.ts`** — the proactive loop. We add `reallocate` (and budget-ratchet) as new auto directive categories; the clear-then-rewrite, autonomous-vs-assisted, and windowed-directive machinery is reused verbatim.
- **`feasibility.ts`** — generalizes: a triathlon feasibility is a *composite* of the three disciplines' projections against the race's demands, plus the crucial **"does the budget support the plan?"** verdict (the new time-feasibility axis this whole doc is about). Same `ahead/on_track/stretch/unrealistic` verdict shape.
- **`DisciplineStrategy` seam (`strategy.ts`)** — `swimStrategy` (new) and `bikeStrategy` (in progress) slot in next to `runStrategy`. The allocator is a *new orchestration layer above* the strategies, not a strategy itself.

### 8.2 What's genuinely new

1. **`timeBudget.ts`** — infer `TimeBudget` from completed `activities` history (§1). Pure/deterministic, DB-free core + a thin server reader (mirrors `adaptation.ts` splitting pure `adaptationLogic.ts` from the DB wrapper).
2. **`swimStrategy`** — CSS anchor, per-100 pace zones, swim workout library, sTSS load. A full `DisciplineStrategy` implementation (largest new discipline chunk; mirrors `bikeStrategy`).
3. **`limiter.ts`** — cohort-percentile limiter analysis + priority vector (§2).
4. **`allocator.ts`** — the §7 heuristic. Pure/deterministic. The centerpiece.
5. **Multi-sport `PlannedDay`** — a `PlannedDay` that can hold *ordered multi-discipline segments* (bricks) and a discipline tag. Story 0's discriminated `prescription` payload (flagged in the cycling spec §6.3) must accommodate this. `plans` becomes multi-discipline (or a `triPlan` groups three linked discipline-plans under one budget + PMC).
6. **`triStrategy` / plan orchestrator** — assembles budget → allocator → per-discipline periodize+generate → merged multi-sport week → adaptation overlay.

### 8.3 Dependencies & sequencing

```
Story 0 (discipline dimension)  ─┐
Cycling engine, incl. §4.4       │→ UNIFIED TSS-EQUIVALENT currency (Option A)   ← HARD PREREQ (§7.4)
  unified-currency decision      ┘
```

| Story | Deliverable | Depends on | Est. |
|---|---|---|---|
| **T0. Unified currency (Option A) confirmed** | rTSS/TSS/sTSS all live; single PMC valid across sports. Mostly the cycling spec's decision + the running-side rTSS change. **Blocking.** | Story 0, cycling Story 1/3 | 2–3 d (shared with cycling) |
| **T1. `timeBudget` inference** | infer realistic weekly hours + DayBudgets from completed `activities`; reconcile vs. stated target; confidence + cold-start. Pure core + server reader. | T0 (needs load history) | 3–4 d |
| **T2. `swimStrategy`** | CSS anchor, per-100 zones, swim workout library, sTSS load. Full DisciplineStrategy. | Story 0, T0 | 4–5 d |
| **T3. Limiter analysis** | cohort percentiles per discipline, system-limiter classification, priority vector. Needs a reference-cohort table (config). | T2 (swim anchor) | 3 d |
| **T4. Allocator (heuristic)** | §7 constrained-greedy: budget+limiters+floors+race-demand → weeklyTargetLoad+split+intensityDist+dayLayout. Pure/deterministic. Return-on-time + race-demand + floor config tables. | T1, T3, T0 | 4–6 d |
| **T5. Multi-sport plan + bricks** | multi-discipline PlannedDay (bricks), plan grouping, merge per-discipline periodize/generate into one week honoring DayBudgets/floors. | T4, cycling generate | 4–5 d |
| **T6. Feasibility (time + composite)** | budget-supports-plan verdict + composite three-discipline race projection; verdict strings. | T4, feasibility.ts | 2–3 d |
| **T7. Re-allocation in the monitor** | `reallocate` + budget-ratchet auto directives; time-shortfall/surplus signals; over/under-delivery ratchet; autonomous/assisted. | T4, monitor.ts | 3 d |
| **T8. `triStrategy` orchestration + console** | assemble the pipeline; engine-params editor for return-on-time/floor/race-demand config; run through adapt/readiness loop end-to-end. | T1–T7 | 3–4 d |

**Critical path:** T0 → T1 → T4 → T5 → T8, with **T0 (unified currency) as the top de-risking item** — it's the shared prerequisite the cycling spec already flagged, and the triathlon allocator is *meaningless* without it. T2 (swim) and T3 (limiters) parallelize once T0 lands. Rough total **≈ 28–36 dev-days** on top of the cycling engine and Story 0.

### 8.4 The one-line summary of the design

> Infer the hours the athlete *actually* trains (not what they claim), find the weakness that costs the most *in this race*, and spend each scarce hour where its marginal race-day return is highest — subject to skill floors that raw load-economics would wrongly zero out — then feed the resulting per-discipline load targets into the periodizer and PMC the engine already has, re-solving whenever the available hours change.

---

## Sources

- **Friel, J., *The Triathlete's Training Bible* (4th ed.)** — limiters ("assess your limiters" relative to the event), training-with-limited-time allocation, ~10%/week volume progression heuristic, event-specificity ("train the demands of the event"), swim frequency > duration for skill, brick rationale.
- **Friel, J., *Fast After 50*** — masters athletes tolerate less high-intensity volume; recovery cost of intensity rises with age (tightens the §3 intensity cap).
- **Seiler, S. & Kjerland, G.Ø. (2006)**; **Seiler, S. (2010), "What is best practice for training intensity and duration distribution in endurance athletes?"** *Int. J. Sports Physiol. Perform.* — the polarized (~80/20) intensity distribution of elite endurance athletes; the low-intensity-volume / high-intensity-quality split and its physiological basis.
- **Stöggl, T. & Sperlich, B. (2014), "Polarized training has greater impact on key endurance variables than threshold, high-intensity, or high-volume training," *Front. Physiol.*** — comparative evidence on intensity-distribution models; supports the volume-vs-intensity trade-off and the h-dependent shift in §3.2.
- **Coggan, A. / TrainingPeaks** — sweet-spot (88–94% FTP) as the highest aerobic-return-per-fatigue band for time-crunched athletes; TSS/IF/NP; the Performance Manager Chart (CTL 42-day / ATL 7-day EWMA of TSS; TSB = CTL − ATL) — matches `engine/fitnessFatigue.ts` (`ctlTau=42, atlTau=7, TSB=CTL−ATL`).
- **Wakayoshi, K. et al. (1992); Ginn, E. (1993)** — Critical Swim Speed / critical velocity: `CSS = (400−200)/(T400−T200)`, the swim threshold anchor (VDOT/FTP analog) used in §2.3 / §7.4.
- **Gabbett, T. (2016), "The training–injury prevention paradox," *Br. J. Sports Med.*** — acute:chronic workload ratio; abrupt load spikes as the dominant injury mechanism → the §1.4 ramp guardrail and §3.3 recovery bound (the ATL-vs-CTL signal the existing monitor already acts on).
- **Published race-split distributions** — mid-pack age-group swim/bike/run time shares (~10–18% / ~50% / ~30–40%, shifting by distance) from TrainingPeaks/Friel course-time breakdowns and finisher-split analyses (§4.1). Directional, cohort-dependent; encoded as tunable `raceDemandWeight` config, not hardcoded constants.

**Existing-code references (composed/extended, not modified):** `src/engine/plan/{types,strategy,periodize,generate,feasibility,raceWindows,paceConfig}.ts`; `src/engine/fitnessFatigue.ts`; `src/server/{adaptation,adaptationLogic,monitor,monitorLogic,compliance,directives}.ts`. **Cycling design dependency:** the `bikeStrategy` spec, esp. its §4.4 unified-load-currency decision (Option A) — a hard prerequisite for this engine's cross-discipline allocation.
