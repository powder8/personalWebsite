# Triathlon goal-time + schedule-constraints engine — Design Doc

**Status:** Design + sports-science research only. **No code changes.** Do not touch prod / `DATABASE_URL`.
**Author:** engine design pass, 2026-08-14
**Scope:** the next evolution of Throughline's triathlon planning — turn a **target FINISH time** + **real-world schedule constraints** into a coordinated, per-sport plan, reusing the per-sport anchor→zones→target machinery and the multi-sport allocator that already ship.
**Relationship to prior docs:** this is the sequel to `docs/multisport/triathlon-time-optimization-spec.md`. That doc built the **volume** axis (hours → per-sport TSS, floors-first, 70.3-weighted — now LIVE as `triAllocatorLogic.ts` / `triPlan.ts` / `server/triSeason.ts`). This doc adds the two axes that doc deferred: the **intensity/target axis** (a goal finish time decomposed into per-leg pace/power targets) and the **schedule axis** (the per-day layout the tri-time-opt spec §7.3 step 6 explicitly deferred).

---

## 0. Thesis — three inputs, one plan

The engine today answers *"given the hours you can train, how should swim/bike/run share them?"* (`allocateTriBudget`). It does **not** yet answer the two questions an age-grouper with a number in their head actually asks:

1. *"I want to go **sub-5:30** at the 70.3 — what does that mean I have to swim/ride/run, and is it realistic?"*  → **goal-time decomposition + feasibility** (§1–§3).
2. *"I can only swim Tue/Thu (pool), my long day is Saturday, and I've got ~45 min on weekday mornings — lay the plan onto **my actual week**."*  → **schedule constraints / per-day layout** (§4).

The design keeps the single-sport engines **byte-identical** and keeps the existing allocator's **volume** output intact. It adds two orthogonal layers on top:

```
                 hours budget ─────────────► allocateTriBudget  ─► per-sport WEEKLY TSS (volume)   [EXISTS]
target FINISH time ──► decomposeGoalTime ─► per-leg TARGET pace/power + required anchor (intensity) [NEW §1]
                                        └─► assessTriFeasibility (3× assessGoalFeasibility)          [NEW §3]
schedule (DayBudget) ─► layoutTriWeek ───► which session lands which day, bricks, pool/long-day     [NEW §4]
                                                    │
                                                    ▼
                        per-sport periodize({volumeUnit}) + generateWeek  → PlannedWeek[]           [UNCHANGED]
                                                    ▼
                        composeTriWeeks → TriWeek[] (now schedule- and target-aware)                [EXTENDED]
```

The **volume** layer sizes each sport's week; the **intensity** layer says *how fast the key sessions should be* (race-pace/goal-power targets threaded into `buildQualitySegments`); the **schedule** layer says *what lands which day*. All three feed the same `generateWeek`.

---

## 1. Goal-time decomposition

### 1.1 The object

```ts
type TriDistance = 'sprint' | 'olympic' | '70.3' | 'ironman'; // already in triAllocatorLogic.ts

interface TriRaceDistances { swimMeters: number; bikeMeters: number; runMeters: number; }
const TRI_DISTANCE_METERS: Record<TriDistance, TriRaceDistances> = {
  sprint:   { swimMeters:  750, bikeMeters:  20000, runMeters:  5000 },
  olympic:  { swimMeters: 1500, bikeMeters:  40000, runMeters: 10000 },
  '70.3':   { swimMeters: 1900, bikeMeters:  90000, runMeters: 21097.5 },
  ironman:  { swimMeters: 3800, bikeMeters: 180000, runMeters: 42195 },
};

interface GoalTimeInput {
  distance: TriDistance;
  targetFinishSeconds: number;             // e.g. sub-5:30 → 19800
  anchors: { run: number /*VDOT*/; bike: number /*FTP W*/; swim: number /*CSS m/s*/ };
  weightKg?: number;                        // for bike watts→speed (from powerConfig.weightKg)
  transitions?: { t1Seconds: number; t2Seconds: number };  // §2; default from DEFAULT_TRANSITIONS
  course?: BikeCourseProfile;               // §1.4; default flat/rolling age-group profile
}

interface LegTarget {
  discipline: Discipline;
  targetSeconds: number;                    // this leg's slice of the moving budget
  // the pace/power the target implies, in the sport's native display unit:
  targetPaceSecPer100?: number;             // swim
  targetWatts?: number; targetIF?: number;  // bike (IF = watts / FTP)
  targetPaceSecPerKm?: number;              // run
  requiredAnchor: number;                   // the anchor (CSS/FTP/VDOT) this target demands at a *sustainable* race intensity
  raceIntensity: number;                    // the %anchor the leg is raced at (sustainable-for-duration)
}

interface GoalDecomposition {
  distance: TriDistance;
  targetFinishSeconds: number;
  transitionSeconds: number;
  movingBudgetSeconds: number;              // finish − transitions
  legs: Record<Discipline, LegTarget>;
  strategy: 'strength_relative' | 'typical_split';
  notes: string[];
}
```

### 1.2 Step 1 — subtract transitions

```
movingBudget = targetFinishSeconds − (t1 + t2)          // §2 for the T1/T2 defaults
```

Sub-5:30 70.3, default combined transition 6:00 → `movingBudget = 19800 − 360 = 19440 s`.

### 1.3 Step 2 — split the moving budget across the three legs

Two strategies; **strength-relative is the default**, typical-split is the cold-start fallback.

**(A) Typical-split distribution (fallback, when anchors are missing/provisional).** Use the published mid-pack share table — already encoded directionally in `RACE_DEMAND_WEIGHT`, but *demand weights ≠ time shares*, so we add an explicit **time-share** table (tunable, cohort-calibrated):

```
TRI_TIME_SHARE['70.3'] = { swim: 0.10, bike: 0.52, run: 0.38 }   // of MOVING time
```

(Consistent with the tri-time-opt spec §4.1: swim ~10%, bike ~50–55%, run ~35–40% for 70.3.) Then `legTarget = movingBudget × share`. Simple, ignores the athlete's individual strengths — hence only the fallback.

**(B) Strength-relative split (default).** The athlete's own anchors predict how *they* distribute time, then we scale all three legs by a single factor so they sum to the budget. This is the key reuse of the per-sport anchors.

```
1. REFERENCE TIME per leg at a nominal, sustainable race intensity (§1.4 predictors):
     swim_ref = predictSwimSeconds(CSS, swimMeters,  I_swim0)     // I_swim0 ≈ 0.90 of CSS (OWS)
     bike_ref = predictBikeSeconds(FTP, weightKg, bikeMeters, I_bike0, course)  // I_bike0 ≈ 0.80 IF
     run_ref  = predictRunSeconds(VDOT, runMeters) × brickFactor  // brickFactor ≈ 1.05 (run-off-bike)
   T_ref = swim_ref + bike_ref + run_ref
2. SCALE to the budget:  k = movingBudget / T_ref
     leg.targetSeconds = ref × k        (Σ = movingBudget by construction)
3. INVERT each scaled target back to the intensity it demands at the CURRENT anchor,
   then to the anchor it demands at a sustainable intensity (§1.5).
```

`k` is itself the headline feasibility signal: **k ≥ 1** → the athlete's current fitness, raced at nominal intensities, already meets the finish; the plan is about sharpening + durability. **k < 1** → they must be faster than nominal everywhere; how much faster, per leg, is what §3 adjudicates. Because we scale *reference times* (not shares), a strong cyclist / weak swimmer automatically gets a bike-light, swim-heavy target distribution — the plan meets them where they are.

**Worked example — sub-5:30 70.3, mid-pack age-grouper** (VDOT 48, FTP 240 W @ 75 kg, CSS 1.30 m/s, flat course, I_swim0=0.90, I_bike0=0.80):
- `swim_ref` = 1900 / (0.90 × 1.30) = **1624 s** (27:04)
- `bike_ref` at IF 0.80 → 192 W → v ≈ 8.6 m/s (§1.4 physics) → 90000/8.6 = **10465 s** (2:54:25)
- `run_ref` = predictRaceTimeSeconds(48, 21097.5) ≈ 5460 s × 1.05 = **5733 s** (1:35:33)
- `T_ref` = 17822 s (4:57:02) of moving time. Budget = 19440 s. **k = 1.091 (k>1)** → this athlete has ~9% of margin: sub-5:30 is comfortably within reach; the leg targets come out *slower* than nominal (swim 29:31 / bike 3:10:20 / run 1:44:12 + 6:00 transitions ≈ 5:29:∼), and §3 will read all three legs "on track / ahead." Push the target to sub-5:00 and k drops below 1, turning one or more legs "stretch."

### 1.4 The per-leg predictors (new pure functions)

Running already has one (`predictRaceTimeSeconds` in `vdot.ts`). Bike and swim need the analog; both are pure, deterministic, tunable — same shape as the existing anchor logic.

**Run** — reuse `predictRaceTimeSeconds(vdot, runMeters)` verbatim, then multiply by a **brick fatigue factor** (running off 90 km of bike is slower than an open half; a 3–8% penalty is the coaching consensus and is itself a trainable quantity — §5, bricks). `brickFactor` is tunable, default ~1.05 for 70.3, ~1.08 for Ironman, ~1.02 for sprint/olympic.

**Swim** — `predictSwimSeconds(css, meters, intensity) = meters / (intensity × css)`, plus an optional open-water offset (`openWaterOffsetSecPer100` already exists on `AthleteSwimConfig`). Race intensity for a continuous 70.3 swim ≈ **0.88–0.92 of CSS** (CSS is a ~critical-velocity threshold; a 1.9 km continuous effort sits just under it). This is the mirror of `predictRaceTimeSeconds` for the swim domain. Inversion (target time → required CSS): `requiredCss = meters / (intensity × targetSeconds)`.

**Bike** — the one genuinely new physics. Cycling has no VDOT-style equivalent-time table; power→speed is a mechanical model (Martin et al. 1998, the validated road cycling power equation). Flat/steady form:

```
P = drivetrainLoss⁻¹ · [ Crr·m·g·v  +  ½·ρ·CdA·v³  +  m·g·grade·v ]
```

Given a target 90 km time → `v = bikeMeters / targetSeconds` → solve for `P` (closed-form on flat; numeric bisection with a course grade profile). Then `targetWatts = P`, `targetIF = P / FTP`. Inversion for feasibility: hold a **sustainable race IF** for the leg duration (70.3 age-group ≈ **0.78–0.83 IF**; longer race → lower IF; Coggan intensity-factor guidance) and back out `requiredFTP = P / raceIF`.

Defaults (tunable config, `BikeCourseProfile`, flagged for cohort calibration like every other constant):
`Crr = 0.005` (good road tyres), `ρ = 1.225 kg/m³`, `CdA = 0.32 m²` (age-group tri, hoods/partial aero; ~0.25 full aero), `drivetrainLoss = 0.975`, `grade = 0` (flat) with a course-profile override, `g = 9.81`, `m = weightKg + bikeKg` (`bikeKg` default 9). These reproduce the ~190 W ≈ 32 km/h ballpark for a mid-pack rider and are the single biggest calibration target once cohort ride files exist.

### 1.5 Step 3 — map each leg target onto the existing anchor→zones→target machinery

This is where decomposition stops being arithmetic and becomes a *plan*. Each leg's target pace/power is threaded into the sessions the same way each single-sport engine already threads its zones:

| Leg | Target expressed as | Maps to existing machinery |
|---|---|---|
| **Swim** | `targetPaceSecPer100 = targetSeconds / (swimMeters/100)` | Locate it against `resolveSwimZones` bands (`swimZonesLogic.ts`): race pace ≈ `threshold`/`aerobic` boundary for 70.3. Race-pace sets become main-set targets in `swimStrategy.buildQualitySegments`. `requiredCss` feeds §3. |
| **Bike** | `targetWatts`, `targetIF = watts/FTP` | Locate against `resolvePowerZones` Coggan bands (`powerZonesLogic.ts`): 0.80 IF ≈ `tempo`/`sweetspot` boundary. Goal-power becomes the race-sim/long-ride target in `bikeStrategy.buildQualitySegments`. `requiredFTP` (and FTP/kg) feeds §3. |
| **Run** | `targetPaceSecPerKm = targetSeconds / (runMeters/1000)` | Locate against `buildZonesFromVdot` %VDOT bands (`vdot.ts`): 70.3 race pace ≈ `marathon`/`threshold` region. Becomes the brick + race-pace run target in `runStrategy.buildQualitySegments`. `requiredVDOT` (invert `predictRaceTimeSeconds`) feeds §3. |

**Nothing in the single-sport engines changes.** The decomposition produces a `LegTarget` per sport; a thin adapter picks the zone the target lands in and passes it as the `zone` argument the strategies already accept. The *targets* are new data threaded through an existing seam — exactly the `DisciplineStrategy.buildQualitySegments(dayVolume, zone, zones, workVolume, …)` contract in `strategy.ts`.

---

## 2. Transitions (T1/T2)

### 2.1 Budget them explicitly

Transitions are dead time the finish clock counts but no leg owns. They must come out of the finish budget *before* the leg split (§1.2), or every leg target is silently too generous.

```ts
interface TransitionBudget { t1Seconds: number; t2Seconds: number; }
const DEFAULT_TRANSITIONS: Record<TriDistance, TransitionBudget> = {
  sprint:  { t1Seconds: 90,  t2Seconds: 60  },   // short, no wetsuit strip on some courses
  olympic: { t1Seconds: 150, t2Seconds: 75  },
  '70.3':  { t1Seconds: 210, t2Seconds: 90  },   // T1 3:30 (wetsuit, long run to bike), T2 1:30
  ironman: { t1Seconds: 300, t2Seconds: 150 },   // change tent, longer everything
};
```

**Why these defaults for 70.3:** age-group T1 (swim→bike: wetsuit strip, helmet, shoes, long carpet to mount line) typically runs **2:30–4:30**, T2 (bike→run: rack, shoes, go) **1:00–2:00**. A combined **~5–6 min** is a defensible mid-pack default; front-of-pack is ~3 min combined, back-of-pack 8+. These are cohort-tunable exactly like the allocator constants, and can later be personalised from the athlete's completed-race splits.

### 2.2 Reflect them in the plan via the bricks that already exist

The plan already emits a weekly **bike→run brick** (`composeTriWeek` tags one `brick: { from:'bike', to:'run' }` on the biggest combined-load day). Transitions connect to that directly:

- **T2 is the brick.** The existing bike→run brick *is* the T2 rehearsal. We extend it from a boolean tag to carry a `transitionTargetSeconds` and a coaching cue ("rack, shoes, out — settle into run target pace within 800 m"). The run segment of the brick inherits the §1 run target *including* the brick fatigue factor, so the athlete rehearses race pace off the bike, not fresh-legs pace.
- **T1 rehearsal** is lower-frequency — a `swim→bike` brick pattern (already named in the tri-time-opt spec §6.2) placed occasionally in the peak phase, keyed to a pool/OWS day that abuts a ride day (§4). Optional for v1; T2 is the priority.
- **Transition drills** (mount/dismount, wetsuit strip) are a small fixed cost folded into the brick day's session note, not a separate session.

No new session *type* is required — transitions ride on the existing brick structure; what's new is (a) subtracting T1+T2 from the finish budget and (b) tagging the brick's run leg with the transition target + brick-pace target.

---

## 3. Feasibility across three sports at once

### 3.1 Reuse `assessGoalFeasibility` per leg

`assessGoalFeasibility` (`feasibility.ts`) already does exactly the right thing for one sport: given `currentAnchor`, `requiredAnchor`, `weeksToRace`, it computes trainable weeks (minus taper), a diminishing typical weekly gain, an achievable gain, a **projected race-day anchor + time**, and a four-way verdict (`ahead / on_track / stretch / unrealistic`) with honest prose. §1.5 produces exactly its inputs *per leg*: `requiredVDOT / requiredFTP / requiredCSS`. So the multi-sport feasibility is **three calls to the same idea**, one per sport, against each leg's target split.

Running plugs in unchanged (`assessGoalFeasibility` is VDOT-native). Bike and swim need their own improvement models — **the `bikeStrategy.assessGoalFeasibility` and `swimStrategy.assessGoalFeasibility` methods are already stubs on the `DisciplineStrategy` seam** (`strategy.ts:99`, stubbed in `bikeStrategy.ts:60` / `swimStrategy.ts:58`). This design fills those stubs with the sport's analog of the Daniels VDOT-gain curve:

```ts
// Generalize the run-specific feasibility into an anchor-agnostic core:
interface AnchorFeasibilityInput {
  currentAnchor: number; requiredAnchor: number; weeksToRace: number;
  taperWeeks: number;
  typicalWeeklyGain(anchor: number): number;   // sport's diminishing-returns curve
  seasonGainCap: number;                        // sport's soft ceiling
  higherIsBetter: boolean;                      // VDOT/FTP/CSS: true
  projectTime(anchor: number): number;          // §1.4 predictor at race intensity
  formatTime(sec: number): string;
}
```

- **Run:** `typicalWeeklyGain = typicalWeeklyVdotGain` (exists), cap 8 VDOT, ~2 taper weeks for a half (`taperWeeksFor`). Unchanged behaviour.
- **Bike:** FTP gains diminish with FTP/kg. Starting curve: ~**+2–3% FTP** for an untrained→trained beginner over a block, tapering to <1% for a well-trained rider; expressed as watts/week from current FTP with a ceiling ~10–12% season-over-season for a first serious build (Coggan/CTL guidance; conservative). Tunable.
- **Swim:** CSS gains for **adult-onset swimmers are technique-dominated and can be large early** (feel unlocks "free" speed — the tri-time-opt spec §2.2/§3.4), then plateau hard. Curve: generous early CSS gain for low-CSS athletes, steep diminishing returns for competent swimmers. This is the one sport where "unrealistic on paper" is often "very reachable with technique work" — the verdict prose must say so.

### 3.2 Aggregate into an honest overall verdict — the multi-sport goal tracker

This is the tri analog of `goalTrackerLogic.ts`, which already fuses **destination** (feasibility) with **trajectory** (consistency) into one honest verdict + "the single lever that moves it." The tri version fuses **three destinations** into one:

```ts
interface TriGoalTracker {
  overall: FeasibilityVerdict;              // the aggregate verdict
  perLeg: Record<Discipline, GoalFeasibility>;
  bindingLeg: Discipline;                   // the leg driving the overall verdict (worst gap)
  realisticFinishSeconds: number;           // Σ projected leg times + transitions
  realisticFinishLabel: string;             // "your honest sub-5:41"
  headline: string; note: string; advocateLine: string;
}
```

**Aggregation rules (deterministic, explainable — the engine's ethic):**

1. **Compute all three per-leg verdicts** against the leg targets from §1.
2. **Overall verdict = the worst leg**, but *reported per leg*, never as a single opaque grade: "your bike split is a stretch; swim is on track; run needs the most work." The `bindingLeg` is the sport with the largest `requiredAnchor − projectedAnchor` gap.
3. **Realistic finish = Σ (projected leg time at each sport's projected race-day anchor) + transitions.** Each `GoalFeasibility.projectedTimeSeconds` already gives the realistic race-day *anchor*; run it back through the §1.4 predictor at race intensity, sum, add T1+T2. This is the honest number — the tri analog of the run goal tracker's "realistic race-day target: ~3:07."
4. **When the target finish is unrealistic, name the driver(s) and give a reachable finish:** "Sub-5:00 needs a 2:35 bike split — that's +18 W FTP in 14 trainable weeks (a real stretch) *and* a swim 90 s faster than your CSS supports. A strong, realistic target for this race is ~5:19, with the bike the limiter; set sub-5:00 for a later race once FTP is up." (Directly mirrors the `unrealistic` branch prose in `feasibility.ts` and the two-lever honesty of `goalTrackerLogic.ts`.)
5. **Fuse with trajectory** the same way the run tracker does: overlay consistency/adherence so a physiologically-reachable finish that the athlete isn't training for reads "drifting," not "on track." Reuse `ConsistencyStats` / `executionLevel` verbatim; the only change is it now spans three sports' completed load.

### 3.3 The relationship between §1's `k` and §3

`k` (the reference-time scale factor) is the *quick* feasibility read; the per-leg `assessGoalFeasibility` is the *rigorous* one. `k < 1` means "must beat nominal intensities" — but whether that's `on_track` or `unrealistic` depends on how far each leg's `requiredAnchor` sits above the athlete's `currentAnchor` and how many trainable weeks remain. §3 is what turns "you're 9% off the pace" into "the bike is fine, the run is the problem, here's the honest finish."

---

## 4. Real-world schedule constraints — the per-day layout

This is the deferred piece from the tri-time-opt spec (§7.3 step 6: "LAY OUT DAYS … place long sessions / bricks on p90 windows; swims on swimAccess days; protect ≥1 recovery day; avoid stacking two high-recovery-cost days"). It is now the binding UX need: `composeTriWeek` currently merges per-sport weeks **by day-of-week as the single-sport engines happened to place them** — it does not respect *the athlete's* availability.

### 4.1 The availability model — `DayBudget`

A 7-element per-day profile (the tri-time-opt spec §1.3 shape, now made concrete and, for the guinea-pig phase, **collected in onboarding** rather than inferred — automatic inference from history is deferred per BUILD_STATUS gates):

```ts
interface DayBudget {
  dow: number;                 // 0=Mon … 6=Sun (matches periodize.dowMon0)
  availableMinutes: number;    // realistic session ceiling this day (0 = off day)
  poolAccess: boolean;         // can a swim happen? (lane time is a hard external constraint)
  isLongDay: boolean;          // the ONE big-block day: long ride / long run / race-sim brick live here
  preferredDisciplines?: Discipline[]; // optional soft hint
}
type WeekSchedule = DayBudget[]; // length 7

interface TriScheduleConstraints {
  schedule: WeekSchedule;
  maxHardSessionsPerDay?: number;      // default 1 — no stacking hard cross-sport work
  minRecoveryDaysPerWeek?: number;     // default 1 — protect ≥1 true rest/easy day
  allowDoubles?: boolean;              // AM/PM stacking when one long window doesn't exist
}
```

Key hard constraints, from the coaching evidence already cited in the tri-time-opt spec:
- **`poolAccess`** is binary and external (lane times/commute) — the allocator must not place a swim on a no-pool day. Swim's floor is *frequency-capped by pool access* (§5 of that spec); if only two pool days exist, the swim floor is satisfied on exactly those two, and a coach note flags it.
- **`isLongDay`** is the *only* place the long ride, long run, and the race-sim brick can live (they exceed weekday windows). Typically the weekend.
- **`availableMinutes = 0`** ⇒ off day; the layout must leave `minRecoveryDaysPerWeek` genuinely empty (or easy-only).
- **No cross-sport hard stacking:** two high-recovery-cost quality sessions (e.g. run threshold + bike VO2) must not land the same day (`recoveryCostPerHour` already ranks run hardest in `DEFAULT_RETURN_ON_TIME`).

### 4.2 How allocator + layout compose

The allocator's job (§ existing) is unchanged: **hours → per-sport weekly TSS + a session count per sport** (`minSessionsPerWeek` is already an allocator output on `TriSportBudget`). What's new is a **layout pass** that assigns each sport's generated sessions to specific days under the constraints — a small constraint-satisfaction / greedy placement, deterministic:

```
layoutTriWeek(perSportWeek, schedule, constraints) →  day→sessions assignment
  1. RANK each sport's sessions by "placement rigidity":
       - long ride / long run / race-sim brick  → hardest to place (need isLongDay + big window)
       - swims                                    → constrained to poolAccess days
       - quality (threshold/VO2) sessions         → need a day with room + no other hard session
       - easy/recovery sessions                   → most flexible (fill remaining windows)
  2. PLACE the long/brick session(s) on isLongDay first (bike+run brick if both have a key long session that week).
  3. PLACE swims only on poolAccess days, honoring the swim frequency floor; if floor > pool days, note the shortfall.
  4. PLACE quality sessions on days with availableMinutes ≥ session duration AND no existing hard session
     (respect maxHardSessionsPerDay and "no back-to-back run-hard days").
  5. FILL easy/recovery sessions into remaining windows; leave ≥ minRecoveryDaysPerWeek empty.
  6. If a session can't fit any day: try a double (allowDoubles) → else DROP the lowest-priority session and note it
     (floors + the binding-leg key session survive; the marginal easy volume is what gets cut — the same
      "degrade gracefully, protect the floor" logic the allocator already uses when hours < floors).
  7. EMIT a day→{discipline: PlannedDay, …} map + placement notes.
```

**Session duration for the fit check** comes from the currency each sport already uses: bike/swim price duration from TSS (`duration = TSS / (IF²·100) · 3600`, already the bike generate formula in BUILD_STATUS), run from meters ÷ training speed (the `runAvgSpeedMetersPerSec` round-trip already in `triPlan.ts`). So "does this session fit `availableMinutes`?" is answerable from data the plan already carries.

### 4.3 Where it slots into `triPlan.ts`

`composeTriWeek` today does a naive by-dow merge and picks the brick day by "max combined load among days where both bike and run already landed." The change is surgical and **additive**:

- `buildTriPlan` gains an optional `schedule?: WeekSchedule` + `constraints?: TriScheduleConstraints`.
- After each sport's `generatePlan` produces its `PlannedWeek[]` (unchanged), a new `layoutTriWeek` **re-assigns the days** of the composed `TriWeek` under the constraints, instead of trusting the single-sport engines' incidental day placement.
- The brick-day selection becomes constraint-driven: **the brick lands on `isLongDay`** (where both a long ride and a run can co-locate), not merely on the incidentally-heaviest day. Falls back to today's heuristic when no `schedule` is supplied (byte-identical to current behaviour → safe, additive).

The single-sport `generateWeek` still decides *what* each session is; the layout decides *when*. That preserves the "single-sport engines unchanged" invariant while finally honoring the athlete's real week.

### 4.4 Interaction with the run leg's native currency

One wrinkle already present in `triPlan.ts`: the run leg periodizes on **miles**, bike/swim on **TSS**. Duration-for-fit is computed per sport (miles→minutes for run via `runAvgSpeedMetersPerSec`, TSS→minutes for bike/swim). The layout pass is currency-agnostic — it only needs each session's **minutes** and **discipline** and whether it's a **key/long/quality** session, all derivable from the existing `PlannedDay` (`runType`, `distanceMeters`/TSS, phase). No schema change; the layout reads what's there.

---

## 5. How it composes with what exists

The three inputs are **orthogonal and multiplicative**, each feeding a different knob of the same `generateWeek`:

| Input | Produces | Drives | Layer |
|---|---|---|---|
| **Hours budget** (exists) | per-sport weekly **TSS** + session counts | `periodize` volume ramp per sport | `allocateTriBudget` → `triPlan` |
| **Goal finish time** (§1) | per-leg **pace/power targets** + required anchors | the **zone/target** the key sessions are run at (`buildQualitySegments`) | new `decomposeGoalTime` |
| **Schedule** (§4) | per-day **placement** | which day each generated session lands + brick day | new `layoutTriWeek` |

**Concretely, one week is built as:**
```
allocateTriBudget(hours, distance, limiter)           → swim/bike/run weekly TSS  [UNCHANGED]
decomposeGoalTime(finish, distance, anchors)          → per-leg race-pace targets  [NEW]
  for each sport:
    periodize({volumeUnit})  [UNCHANGED]  ── ramps the TSS/miles from §-allocator
    generateWeek(zones, targets)          ── same engine; the goal-pace target picks the quality zone  [UNCHANGED CONTRACT]
layoutTriWeek(perSportWeek, schedule)                 → day assignment + brick on long day  [NEW]
composeTriWeeks                                        → TriWeek[], now schedule- & target-aware  [EXTENDED]
```

### 5.1 What grows vs. stays

| Module | Verdict |
|---|---|
| **Single-sport engines** (`runStrategy`, `bikeStrategy`, `swimStrategy`, `generate.ts`, `periodize.ts`, zone builders, `vdot.ts`) | **Unchanged.** They already accept a `zone` target through `buildQualitySegments`; §1 just supplies a *race-pace* zone. Run stays byte-identical. |
| **`triAllocatorLogic.ts`** | **Unchanged core.** Still hours→TSS floors-first. Optionally reads `bindingLeg` from §3 to nudge `limiterBoost` toward the feasibility-driven limiter instead of the self-reported one (post-guinea-pig). |
| **`triPlan.ts`** | **Grows.** `buildTriPlan` gains `goalFinishSeconds?`, `schedule?`, `constraints?`. New `decomposeGoalTime` + `layoutTriWeek`. `composeTriWeek` brick-day selection becomes schedule-aware (with the current heuristic as the no-schedule fallback). |
| **`server/triSeason.ts`** | **Grows.** `setupTriSeason` accepts the finish target + schedule, calls the feasibility aggregate, persists the goal-time + realistic-finish alongside the plan. Anchor-resolution contract (`resolveTriZones`) unchanged. |
| **`feasibility.ts`** | **Refactored, not broken.** Extract the anchor-agnostic core (`AnchorFeasibilityInput`); run keeps its exact current numbers. |
| **`bikeStrategy` / `swimStrategy` `assessGoalFeasibility`** | **Stubs filled** (they already exist on the seam). |
| **New pure modules** | `triGoalTimeLogic.ts` (decomposition + bike/swim predictors), `triFeasibilityLogic.ts` (aggregate verdict), `triScheduleLogic.ts` (`DayBudget` + `layoutTriWeek`), `triGoalTrackerLogic.ts` (the multi-sport tracker, mirroring `goalTrackerLogic.ts`). |
| **DB / migrations** | **Additive.** Store `targetFinishSeconds` + `WeekSchedule` on the athlete/race (jsonb, like `paceConfig`/`swimConfig`). No plan-schema change — sessions still persist per-sport per-week via `persistPlanDraft`. |

### 5.2 The invariant this preserves

Every layer degrades to today's behaviour when its input is absent: no finish target → allocator-only volume plan (today); no schedule → current naive by-dow merge; no bike/swim feasibility model → the existing stubs. So the whole thing is **additive and runner/tri-neutral** — the BUILD_STATUS non-negotiable.

---

## 6. Sequenced build plan

Dependencies flow: goal-time predictors → feasibility aggregate; schedule model is independent and parallelizable; the tracker/onboarding are last.

| Story | Deliverable | Depends on | Est. |
|---|---|---|---|
| **G1. Bike & swim time predictors** | `predictBikeSeconds` (Martin power model + `BikeCourseProfile`), `predictSwimSeconds` (CSS × race-intensity), race-intensity + brick-factor config tables. Pure, tested against known splits. | — | 3–4 d |
| **G2. Goal-time decomposition** | `decomposeGoalTime`: transitions → moving budget → strength-relative split (fallback typical-split) → per-leg targets + required anchors → zone mapping adapter. `DEFAULT_TRANSITIONS`, `TRI_TIME_SHARE`. | G1 | 3 d |
| **G3. Anchor-agnostic feasibility + bike/swim models** | Refactor `feasibility.ts` to `AnchorFeasibilityInput` core (run unchanged); fill `bikeStrategy`/`swimStrategy.assessGoalFeasibility` with FTP-gain / CSS-gain curves. | G2 (required anchors) | 3–4 d |
| **G4. Tri feasibility aggregate + realistic finish** | `assessTriFeasibility`: 3× per-leg, binding-leg, Σ projected + transitions → realistic finish, honest per-leg prose. | G3 | 2–3 d |
| **G5. `DayBudget` schedule model + `layoutTriWeek`** | The constraint model + greedy placement (long/brick on `isLongDay`, swim on `poolAccess`, no hard stacking, protect recovery, graceful drop). Additive to `composeTriWeek` with no-schedule fallback. Pure/deterministic. | — (parallel to G1–G4) | 4–5 d |
| **G6. Transitions in the brick** | Extend the brick tag to carry `transitionTargetSeconds` + brick-pace run target; optional swim→bike T1 brick in peak. | G2, G5 | 1–2 d |
| **G7. `triPlan` + `triSeason` wiring** | Thread `goalFinishSeconds` + `schedule` through `buildTriPlan`/`setupTriSeason`; persist finish target + schedule (additive jsonb). | G2, G4, G5 | 2–3 d |
| **G8. Multi-sport goal tracker (portal)** | `triGoalTrackerLogic.ts` mirroring `goalTrackerLogic.ts`: destination×trajectory across 3 sports, per-leg bars, binding-leg advocate line, realistic-finish headline. | G4, G7 | 3 d |
| **G9. Onboarding: finish time + schedule** | Collect target finish + `WeekSchedule` (pool days, long day, per-day minutes) in the tri onboarding alongside the existing distance/hours/limiter/anchors. | G7 | 2–3 d |

**Critical path:** G1 → G2 → G3 → G4 → G7 → G8. **G5 (schedule) parallelizes** entirely (disjoint files, no dependency on the goal-time chain) — run it as a concurrent worktree (BUILD_STATUS confirms worktree parallelism works from this repo). Rough total **≈ 23–30 dev-days**, of which the goal-time chain is the spine and the schedule layer is an independent ~5-day track.

### 6.1 What to tune with cohort data (the guinea-pig → public loop)

All of these are **defensible starting values flagged tunable**, exactly like the allocator's existing constants (`TYPICAL_WEEKLY_IF`, `RACE_DEMAND_WEIGHT`, floors):

- **Bike physics** — `CdA`, `Crr`, `drivetrainLoss`, `bikeKg`: the single biggest calibration target. Recover per-athlete `CdA` from completed ride files (power + speed + grade) and replace the population default; a wrong `CdA` skews every bike target and the bike feasibility verdict.
- **Race intensities** — `I_swim0 ≈ 0.90 CSS`, `I_bike0 / raceIF ≈ 0.78–0.83`, run brick factor `≈ 1.05`: calibrate from cohort race splits vs. pre-race anchors. These directly set how aggressive each leg target is.
- **Transitions** — `DEFAULT_TRANSITIONS`: replace with the cohort's actual T1/T2 distributions, then personalise from each athlete's race history.
- **Time shares** — `TRI_TIME_SHARE['70.3']`: validate the 10/52/38 fallback against the cohort's finisher splits.
- **Feasibility gain curves** — bike FTP-gain and swim CSS-gain curves + season caps: the least-evidenced pieces (running's Daniels curve is well-grounded; bike/swim are coaching heuristics). Re-fit from repeated cohort test→retest anchor deltas.
- **Schedule realism** — once completed-training history exists, *infer* `DayBudget` from the day-of-week histogram (the tri-time-opt spec §1.2/§1.3 auto-inference, deferred here to post-race per BUILD_STATUS gates), replacing the onboarding-collected schedule.

---

## Sources

- **Jack Daniels, *Daniels' Running Formula*** — VDOT and equivalent-race-performance model; the run predictor (`predictRaceTimeSeconds` in `vdot.ts`) and the run gain curve in `feasibility.ts` (`typicalWeeklyVdotGain`, ~1 VDOT/few weeks for trained runners).
- **Wakayoshi et al. (1992); Ginn (1993)** — Critical Swim Speed, `CSS = (D2−D1)/(T2−T1)`; the swim anchor and threshold-intensity basis for `predictSwimSeconds` (already implemented in `cssLogic.ts`).
- **Allen & Coggan, *Training and Racing with a Power Meter*** — FTP, Intensity Factor, TSS; the 70.3 sustainable-IF range (~0.78–0.83) and the sweet-spot/tempo bands the bike target lands in (`powerZonesLogic.ts`).
- **Martin, J.C. et al. (1998), "Validation of a mathematical model for road cycling power," *J. Applied Biomechanics*** — the power = rolling + aero + gravity + drivetrain equation used for `predictBikeSeconds` (watts↔speed↔time) and the `requiredFTP` inversion.
- **Joe Friel, *The Triathlete's Training Bible* (4th ed.)** — limiter-relative-to-the-event framing (drives the binding-leg verdict), brick rationale and run-off-bike durability (the brick fatigue factor), transition practice, ~10%/week progression guardrail.
- **Millet, Vleck & Bentley (2009), "Physiological differences between cycling and running," *Sports Medicine*** — the run-off-bike ("jelly legs") physiology behind the brick fatigue factor and why T2/brick rehearsal has leverage beyond its time share.
- **Published 70.3 age-group split distributions** (TrainingPeaks / Friel course-time breakdowns; finisher-split analyses) — swim ~10% / bike ~50–55% / run ~35–40% of race time → the `TRI_TIME_SHARE` fallback and transition-norm defaults (T1 ~2:30–4:30, T2 ~1:00–2:00 for 70.3). Directional and cohort-dependent → encoded as tunable config, not hardcoded constants.
- **`docs/multisport/triathlon-time-optimization-spec.md`** — the volume/allocation predecessor; §1.3 `DayBudget` shape (§4 here makes it concrete), §4.1 split table, §6 bricks, §7.3 step 6 deferred day-layout (delivered here).

**Existing-code references (composed/extended, not modified):** `src/engine/plan/{triAllocatorLogic,triPlan,feasibility,vdot,cssLogic,ftpLogic,powerZonesLogic,swimZonesLogic,periodize,strategy,runStrategy,bikeStrategy,swimStrategy}.ts`; `src/engine/transferLogic.ts`; `src/server/{triSeason,goalTrackerLogic}.ts`; `src/db/{paceConfig,powerConfig,swimConfig}.ts`.
