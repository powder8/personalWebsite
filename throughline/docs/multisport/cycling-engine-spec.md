# Cycling Coaching Engine — Design Doc (`bikeStrategy`)

**Status:** Design + research only. No code changes. Depends on Story 0 ("discipline dimension" refactor) landing first.
**Author:** engine design pass, 2026-08-10
**Scope:** the cycling analog of `src/engine/plan/*` — a duration-at-power engine that mirrors the running (distance-at-pace) engine's structure so both slot behind one per-sport `DisciplineStrategy`.

---

## 0. Orientation — what we are mirroring

The running engine is a pure, deterministic, DB-free pipeline:

```
fitness anchor (VDOT)  →  pace zones  →  periodize (backward from race)  →  generate week  →  adapt
   paceConfig.ts            zones.ts /       periodize.ts                    generate.ts       adapt.ts
   (vdot.ts)                vdot.ts                                          workouts.ts
```

Key running facts that define the shape we must generalize:

| Running concept | File | Cycling analog (this doc) |
|---|---|---|
| VDOT fitness number (VO2max proxy from a race) | `vdot.ts`, `db/paceConfig.ts` | **FTP** (Functional Threshold Power, W) |
| `athletes.paceConfig` jsonb (two-level: global model + athlete overrides) | `plan/paceConfig.ts` | **`athletes.powerConfig` jsonb** (§1) |
| Pace zones = threshold-anchored bands in **sec/km** | `zones.ts` | **Power zones = %FTP bands in watts** + **HR fallback = %LTHR** (§2) |
| Quality-session templates (`reps × repMeters @ zone`) | `workouts.ts` | **Duration × %FTP interval sessions** (§3) |
| Load = **Banister TRIMP** (HR) or volume fallback | `engine/load.ts` | **TSS** from NP/IF (power) or hrTSS/estimated (§4) |
| Weekly target = **`weeklyTargetMeters`** | `periodize.ts`, `plans.weeklyTargetMeters` | **`weeklyTargetTss`** (§4) |
| Session target = distance @ pace | `plannedSessions.targetDistanceMeters` / `targetPace*` | **duration @ target watts** (§4, §6) |
| CTL/ATL/TSB Banister PMC | `engine/fitnessFatigue.ts`, `fitness_fatigue_states` | **shared, unchanged** — but load units must be reconciled (§4.4 — the main integration risk) |
| `races` (distance + target time) | `db/schema.ts` races, `raceWindows.ts`, `feasibility.ts` | **events**: gran fondo / TT / stage race / FTP goal (§5) |
| `generatePlan(...)` glue | `plan/index.ts` | per-sport strategy dispatch (§6) |

The running engine's governing principle — *"fidelity now, generalize later; the model is config, not hardcoded logic"* — carries over verbatim. Everything below is designed as **tunable config layered global → athlete**, exactly like `GlobalPaceModel` + `AthletePaceConfig`.

---

## 1. FTP anchor — the VDOT analog

### 1.1 What FTP is

FTP (Functional Threshold Power) is the highest power, in watts, a rider can hold in a quasi–steady state for ~1 hour; it approximates the power at lactate threshold / MLSS. It is cycling's single "fitness number" and plays the exact role VDOT plays for running: the one scalar from which all training zones and load targets are derived. Just as `db/paceConfig.ts:getAthleteVdot` resolves one VDOT from a race/threshold/explicit anchor, `bikeStrategy` resolves one FTP.

### 1.2 `powerConfig` jsonb (mirror of `AthletePaceConfig`)

Stored in a new `athletes.powerConfig jsonb` column (analogous to `athletes.paceConfig`). Two-level, layered on a `GlobalPowerModel` in `engine_settings` (add a `powerModel jsonb` column, sibling of `paceModel`).

```ts
// engine/plan/powerConfig.ts  (mirror of plan/paceConfig.ts)

export type PowerZoneModel = Record<PowerZoneKey, { lo: number; hi: number }>; // %FTP bounds (fractions)

export interface GlobalPowerModel {
  zones: PowerZoneModel;             // Coggan defaults (§2.2)
  hrZones?: HrZoneModel;             // %LTHR fallback bands (§2.3)
  // FTP test → FTP multipliers, tunable by the coach:
  rampFactor?: number;               // default 0.75
  twentyMinFactor?: number;          // default 0.95
  eightMinFactor?: number;           // default 0.90
}

export interface AthletePowerConfig {
  // --- fitness anchors (provide one; resolution order in §1.4) ---
  ftpWatts?: number;                 // explicit FTP
  ftpTest?: FtpTest;                 // a raw test to derive FTP from (§1.3)
  lthrBpm?: number;                  // lactate-threshold HR, for the HR fallback (§2.3)
  weightKg?: number;                 // for W/kg display + event feasibility (climbing)
  // --- provenance (identical semantics to paceConfig.anchorSource) ---
  anchorSource?: 'auto' | 'manual';
  // --- per-athlete overrides layered on the global model ---
  zones?: Partial<PowerZoneModel>;   // custom %FTP bands
  zoneOverrides?: Partial<Record<PowerZoneKey, { loWatts?: number; hiWatts?: number }>>;
  // --- rider strength bias (sprinter ↔ time-triallist), the McMillan analog ---
  strengthBias?: number;             // [-1,+1]: +1 punchy/anaerobic, -1 diesel/threshold
}

export interface FtpTest {
  kind: 'ramp' | 'twenty_min' | 'eight_min' | 'sixty_min' | 'power_curve' | 'threshold_ride';
  // one of:
  best1MinWatts?: number;            // ramp
  avg20MinWatts?: number;            // 20-min test
  avg8MinWatts?: number;             // two 8-min efforts (avg)
  avg60MinWatts?: number;            // 60-min TT (definitional)
  powerCurve?: Array<{ durationSeconds: number; watts: number }>;  // mean-maximal curve
  date?: string;
}
```

### 1.3 FTP estimation methods (the `vdotFrom*` analogs)

Mirror `vdot.ts:vdotFromRace` / `paceConfig.ts:vdotFromThreshold` with a family of `ftpFrom*` pure functions. All multipliers live in `GlobalPowerModel` so the coach can tune them.

**(a) Ramp test** — ride an increasing-ramp to exhaustion; take the best rolling 1-minute power:
```
FTP = 0.75 × best_1min_power
```
Convention used by TrainerRoad/Zwift ramp protocols. `rampFactor` default `0.75`.

**(b) 20-minute test** — after a hard opener, 20 min all-out; average power ×0.95:
```
FTP = 0.95 × avg_20min_power
```
The canonical Allen & Coggan field test. The 0.95 subtracts the ~5% anaerobic contribution over 20 min vs. 60 min. `twentyMinFactor` default `0.95`.

**(c) 8-minute test** (Carmichael) — two 8-min max efforts, average them:
```
FTP = 0.90 × avg_8min_power
```
`eightMinFactor` default `0.90`. Reads a bit higher than the 20-min protocol; offered for athletes who can't hold a single 20.

**(d) From a best-effort power curve (the `bestEffort.ts` analog)** — given a mean-maximal power curve (best watts for each duration, extractable from ride streams exactly as `bestSustainedEffort` slides a window over splits/laps), fit the 2-parameter **Critical Power** model:
```
P(t) = W'/t + CP      (Monod & Scherrer 1965; Jones et al.)
```
Solve CP and W′ by linear regression of P against 1/t over efforts in ~3–20 min. Then `FTP ≈ CP` (CP typically 0.97–1.0 × FTP; expose the coefficient as config). This is the cycling twin of deriving VDOT from the hardest sustained block of an activity — reuse the sliding-window idea from `bestEffort.ts`, keyed on *duration/power* instead of *distance/pace*.

**(e) From a threshold ride** — a ~40–60 min steady effort at subjective threshold: `FTP = avg_60min_power` directly (definitional), or `= 0.95 × avg` if only ~20 min was truly maximal. This is the direct analog of `vdotFromThreshold` (treat threshold as a ~1 hr effort).

### 1.4 Resolving the single fitness number (mirror of `getAthleteVdot`)

```ts
export function resolveFtp(cfg: AthletePowerConfig, global: GlobalPowerModel): number | null {
  if (cfg.ftpWatts != null) return cfg.ftpWatts;                 // explicit wins (like cfg.vdot)
  if (cfg.ftpTest)         return ftpFromTest(cfg.ftpTest, global);
  if (cfg.lthrBpm != null) return null;                          // HR-only athlete: no FTP, use HR zones (§2.3)
  return null;                                                   // → caller falls back to intake / HR
}
```
Resolution order and philosophy copy `db/paceConfig.ts:getAthleteVdot` exactly: explicit number → test-derived → external fallback. As in the note there, **the fitness number is taken directly from the anchor, never re-derived from the resolved training zones** (zones carry bias/overrides that must not move FTP). `anchorSource: 'auto'` values get refreshed as new rides arrive; `'manual'` are left until a human edits them — identical to the pace side.

**Auto-anchoring from ride history:** on ingest, extract the ride's best-effort power curve, feed durations 3–20 min through the CP fit, and propose an FTP. If it exceeds the stored auto-FTP by a margin, update it (a rider's best 20-min power in a hard group ride is a de-facto field test). This mirrors how running auto-updates VDOT from `bestEffortAcross`.

---

## 2. Power + HR zones — the `zones.ts` analog

### 2.1 Zone keys (the `ZoneKey` analog)

```ts
export type PowerZoneKey =
  | 'recovery'    // Coggan Z1  Active Recovery
  | 'endurance'   // Coggan Z2  Endurance
  | 'tempo'       // Coggan Z3  Tempo
  | 'sweetspot'   // 88–94% FTP — sub-zone straddling Z3/Z4 (coach-added, like running 'maintenance')
  | 'threshold'   // Coggan Z4  Lactate Threshold
  | 'vo2max'      // Coggan Z5  VO2max
  | 'anaerobic'   // Coggan Z6  Anaerobic Capacity
  | 'sprint';     // Coggan Z7  Neuromuscular Power
```
Note the deliberate parallel to running's `maintenance` sub-zone: **`sweetspot`** is a coach-added band folded between Coggan Z3 and Z4 (88–94% FTP), the highest-return endurance-training zone, kept as a tunable sub-zone exactly as `maintenance` sits between Daniels E and M.

### 2.2 Coggan 7-zone model — exact %FTP boundaries

`buildPowerZones(ftp, model)` mirrors `buildZones(threshold, model)`: multiply FTP by each band's bounds to get watts.

| Zone key | Coggan zone | %FTP (lo–hi) | Purpose |
|---|---|---|---|
| `recovery` | Z1 Active Recovery | 0 – 55% | spin, between-interval |
| `endurance` | Z2 Endurance | 56 – 75% | aerobic base, long rides |
| `tempo` | Z3 Tempo | 76 – 90% | "brisk", muscular endurance |
| `sweetspot` | (Z3/Z4) | 88 – 94% | max aerobic return per fatigue |
| `threshold` | Z4 Lactate Threshold | 91 – 105% | raise FTP, TT effort |
| `vo2max` | Z5 VO2max | 106 – 120% | 3–8 min intervals |
| `anaerobic` | Z6 Anaerobic Capacity | 121 – 150% | 30 s–3 min |
| `sprint` | Z7 Neuromuscular | 150%+ (uncapped) | <30 s, all-out |

Source: Allen & Coggan, *Training and Racing with a Power Meter* (7-level classic model). `sweetspot` intentionally overlaps Z3/Z4 — it is a training band, not a partition, so downstream code must treat it as an alias band, not part of a mutually exclusive tiling.

```ts
export const DEFAULT_POWER_ZONES: PowerZoneModel = {
  recovery:  { lo: 0.00, hi: 0.55 },
  endurance: { lo: 0.56, hi: 0.75 },
  tempo:     { lo: 0.76, hi: 0.90 },
  sweetspot: { lo: 0.88, hi: 0.94 },
  threshold: { lo: 0.91, hi: 1.05 },
  vo2max:    { lo: 1.06, hi: 1.20 },
  anaerobic: { lo: 1.21, hi: 1.50 },
  sprint:    { lo: 1.50, hi: 3.00 },  // hi is a display cap only
};
```

`PowerZones` mirrors `PaceZones`: `{ ftpWatts, zones: Record<PowerZoneKey, { loWatts; hiWatts }> }`. Threshold is the natural display/parity anchor (as `thresholdSecPerKm` is for pace).

### 2.3 HR-based fallback (%LTHR) — for athletes with no power meter

When `resolveFtp` returns null but `lthrBpm` is set, drive zones off **Lactate Threshold Heart Rate** using Coggan/Friel %LTHR bands. HR is only meaningful up to ~threshold (it saturates and lags above it), so the top zones collapse:

| Zone | %LTHR |
|---|---|
| `recovery` (Z1) | < 68% |
| `endurance` (Z2) | 69 – 83% |
| `tempo` (Z3) | 84 – 94% |
| `threshold` (Z4) | 95 – 105% |
| `vo2max`+ (Z5a and up) | > 106% (HR unreliable — prescribe by RPE/duration) |

Source: Coggan HR zones (Allen & Coggan). `HrZoneModel` is a sibling of `PowerZoneModel` in `GlobalPowerModel`. A rider with only `lthrBpm` gets HR-target sessions; a rider with FTP gets power targets **plus** an HR band as a secondary cue (many head units display both). Estimating LTHR: ~average HR of the final 20 min of a 30-min solo TT (Friel protocol), or `lthrBpm ≈ threshold-ride avg HR`.

### 2.4 Strength bias (the `strengthBias` analog)

`applyStrengthBias` from `plan/paceConfig.ts` translates directly: `+1` (sprinter/punchy) raises anaerobic/sprint band ceilings and trims threshold emphasis; `-1` (diesel/TT) does the reverse. Same `[-1,+1]` clamp, same "tilt in watts at |bias|=1" table.

---

## 3. Cycling workout library — the `workouts.ts` analog

Sessions are **duration × %FTP**, structured **warm-up → main set → cool-down**, exactly as running sessions are **distance × pace** with `warmup/work/cooldown` segments. Reuse the `QualityTemplate` pattern (id, label, zone, `work()` builder, `prose()` mirror) and the deterministic seed rotation (`pickTemplate(zone, seed)`) so an athlete isn't handed the identical VO2 session every week.

### 3.1 Segment model (mirror of `WorkoutSegment`)

Running's `WorkoutSegment` is `{ role, zone, reps?, repMeters?, distanceMeters?, restSeconds? }`. The cycling twin swaps distance for duration and adds a power target:

```ts
export interface BikeSegment {
  role: 'warmup' | 'work' | 'recovery_spin' | 'cooldown';
  zone: PowerZoneKey;
  reps?: number;
  repSeconds?: number;        // interval length (replaces repMeters)
  durationSeconds?: number;   // continuous block (replaces distanceMeters)
  restSeconds?: number;
  targetLoWatts?: number;     // filled from zones at build time
  targetHiWatts?: number;
  note?: string;
}
```

### 3.2 The library (each with warm-up / work / cool-down)

Standard warm-up = 10–20 min ramping `recovery`→`endurance` with 2–3 × 30 s openers into `vo2max`; cool-down = 10 min `recovery`. Example concrete sessions (paces/watts are always the athlete's own from §2, never verbatim):

| Session | Zone | Example main set | Typical IF | ~TSS (1 h total) |
|---|---|---|---|---|
| **Endurance** | `endurance` | 60–180 min continuous @ 65–75% FTP | 0.65 | ~55–75/h |
| **Tempo** | `tempo` | 3 × 15 min @ 80–85% FTP, 5 min easy | 0.82 | ~68/h |
| **Sweet-spot** | `sweetspot` | 3 × 12 min @ 88–93% FTP, 4 min easy | 0.90 | ~80/h |
| **Threshold (over-unders)** | `threshold` | 3 × (2 min @ 105% / 2 min @ 95%) ×3, 5 min easy | 0.97 | ~90/h |
| **Threshold (steady)** | `threshold` | 2 × 20 min @ 95–100% FTP, 8 min easy | 0.98 | ~95/h |
| **VO2max** | `vo2max` | 5 × 4 min @ 110–118% FTP, 4 min easy (1:1) | 1.05 | ~100/h |
| **VO2max (30/30)** | `vo2max` | 2 × (10 × 30 s @ 120% / 30 s easy), 5 min between | 1.02 | ~95/h |
| **Anaerobic** | `anaerobic` | 6 × 1 min @ 130–150% FTP, 3 min easy | — | by duration |
| **Sprint / neuromuscular** | `sprint` | 8 × 15 s max, 3–5 min full recovery | — | by duration |

Concrete template example (mirrors `THRESHOLD_TEMPLATES` in `workouts.ts`):

```ts
const THRESHOLD_TEMPLATES: BikeQualityTemplate[] = [
  {
    id: 'thr-2x20',
    label: '2 × 20 threshold',
    zone: 'threshold',
    work(workMin, z) {
      const each = clampInt(workMin / 2, 10, 25);
      return [{ role: 'work', zone: 'threshold', reps: 2, repSeconds: each * 60, restSeconds: 8 * 60,
        targetLoWatts: z.zones.threshold.loWatts, targetHiWatts: z.zones.threshold.hiWatts,
        note: `2 × ${each} min @ ${wattsLabel(z.zones.threshold)} · 8 min easy between — steady, controlled` }];
    },
    prose: (m, z) => `2 × ${clampInt(m/2,10,25)} min @ ${wattsLabel(z.zones.threshold)} with 8 min easy`,
  },
  {
    id: 'thr-over-under',
    label: 'Over-unders',
    zone: 'threshold',
    work(workMin, z) { /* 2 min @105% / 2 min @95% blocks filling workMin */ },
    prose: (m, z) => `${clampInt(m/12,2,4)} × (3× 2min over / 2min under) around ${wattsLabel(z.zones.threshold)}`,
  },
];
```

Zones without a template (endurance, recovery) fall back to a continuous block — exactly the running fallback (`continuousWork`). `wattsLabel({loWatts,hiWatts})` is the display twin of `paceRangeLabel`; W/kg shown alongside using `weightKg`.

### 3.3 Endurance-ride "embedded work" (the long-run analog)

Running's `longRunSegments` embeds marathon-pace blocks in build/peak long runs. The cycling twin embeds **sweet-spot or tempo blocks** in long endurance rides during build/peak (e.g. a 3 h Z2 ride with 3 × 15 min sweet-spot in the middle third) — same structure: easy lead-in, work blocks, easy finish.

---

## 4. Load & periodization

### 4.1 TSS from power (NP / IF) — the primary path

**Normalized Power (NP)** — accounts for the metabolic cost of variable efforts (Allen & Coggan):
1. 30-second rolling average of the power stream.
2. Raise each rolling value to the **4th power**.
3. Average those values.
4. Take the **4th root**. → NP (watts).

**Intensity Factor (IF)** = `NP / FTP`.

**Training Stress Score (TSS)**:
```
TSS = (duration_seconds × NP × IF) / (FTP × 3600) × 100
    = IF² × duration_hours × 100
```
Calibration: 1 hour at exactly FTP → IF = 1.0 → **TSS = 100**. Source: Allen & Coggan; confirmed against multiple TSS calculators.

### 4.2 TSS when power is absent — hrTSS / estimated (the `estimateLoad` twin)

`engine/load.ts:estimateLoad` already does exactly this shape for running (Banister TRIMP from HR, else volume fallback, flagged `estimated`). Cycling adds two rungs so all three disciplines share one ladder:

1. **Power present →** true TSS (§4.1). `estimated: false`.
2. **HR present, no power → hrTSS.** Compute Banister TRIMP (reuse `banisterTrimp` verbatim — it's sport-agnostic) and rescale so 1 h at LTHR = 100:
   `hrTSS = TRIMP(session) / TRIMP(1h @ LTHR) × 100`. `estimated: true` (HR lags/saturates on the bike). Alternatively time-in-HR-zone weighting (TrainingPeaks hrTSS) if zone streams exist.
3. **Neither → estimated TSS from duration × assigned IF.** Each planned session already carries a target zone → assign a nominal IF (endurance 0.65, tempo 0.82, sweetspot 0.90, threshold 0.98, vo2max 1.05) and use `TSS = IF² × hours × 100`. This is how **planned** sessions get a `targetLoad` before they're ridden. `estimated: true`.

```ts
export function bikeLoad(session: BikeSessionForLoad, ftp: number | null, hr?: HrParams | null): LoadResult {
  if (session.powerStream && ftp) return { load: tssFromPower(session.powerStream, ftp), estimated: false };
  if (session.avgHr != null && hr && session.lthrBpm) return { load: hrTss(...), estimated: true };
  return { load: estimatedTss(session.durationSeconds, session.assignedIf), estimated: true };
}
```

### 4.3 Weekly TSS targets replace `weeklyTargetMeters`

Running periodizes on **miles** (`periodize.ts` ramps `startVolumeMiles → peakVolumeMiles`, down-week ×0.82, taper fracs). Cycling periodizes identically but on **weekly TSS**:
- `startVolumeMiles / peakVolumeMiles` → `startWeeklyTss / peakWeeklyTss`.
- Everything else in `periodize.ts` — backward layout from event date, phase allocation (base/build/peak/taper), lerp ramp, `downWeekEvery` ×0.82, taper fractions `[0.7,0.55,0.4]`, tune-up mini-tapers — is **unit-agnostic and reused unchanged**. Only the scalar's meaning and label change.
- `generateWeek` distributes the week's TSS across ride days by `volumeWeight` instead of distributing miles; the long-ride fraction replaces `longRunFraction`; per-day TSS → duration via the day's target zone/IF (`duration = TSS / (IF² × 100) × 3600`).

**Design consequence (§6 flags this):** the shared periodizer must operate on an **abstract weekly-volume scalar with a per-discipline unit**, not on `meters`. `plans.weeklyTargetMeters` should generalize to `weeklyTargetLoad` + `loadUnit ∈ {meters, tss}` (or keep both columns and let the strategy pick).

### 4.4 Shared CTL/ATL/TSB (PMC) — reuse `fitnessFatigue.ts`, but reconcile units ⚠️

`engine/fitnessFatigue.ts:computeFitnessFatigue` is already a pure Banister EWMA over a stream of `{ day, value }` daily loads, with `ctlTau=42, atlTau=7, TSB = CTL − ATL`. That is **exactly** the TrainingPeaks Performance Manager Chart (Coggan) definition:
- **CTL** = 42-day exponentially-weighted average of daily load (fitness).
- **ATL** = 7-day EWMA (fatigue).
- **TSB** = yesterday's CTL − ATL (form).

So the PMC needs **no cycling-specific code** — cycling just contributes daily-load rows. **But there is one hard integration risk:**

> **⚠️ Unit reconciliation.** Running currently feeds the PMC **Banister TRIMP** (arbitrary units, ~0–150/session), while cycling produces **TSS** (100 = 1 h at threshold). These are *different scales*. Summing raw TRIMP and raw TSS into one CTL is physiologically meaningless and will corrupt any multi-sport athlete's fitness/fatigue/form.

**Recommended resolution (pick one, decide in Story 0/1):**
- **(A) Unify on TSS-equivalent (preferred).** Give running an rTSS too: `rTSS = IF² × hours × 100` where running IF = (threshold pace / actual pace)-based, or normalize existing TRIMP so 1 h at threshold HR = 100 (same rescale as hrTSS in §4.2). Then all disciplines speak TSS and the PMC is truly shared. This is a small, well-defined running-side change but it **touches the existing running load path** — call it out as a Story-0 dependency.
- **(B) Keep the PMC in TRIMP.** Convert cycling TSS→TRIMP-equivalent on the way into the PMC via a per-discipline scaling constant. Simpler, no running-side change, but the scaling constant is a fudge and TSS is the more standard currency.

Either way, `activities.trainingLoad` (already exists) becomes the single common-currency column, and `fitness_fatigue_states` stays as-is. **This is the single most important cross-discipline decision in the whole refactor** and should be nailed down before Story 1.

---

## 5. Events — generalizing the `races` model

Running `races` = `{ distanceMeters, distanceLabel, targetTimeSeconds, targetPaceSecPerKm, priority, purpose, goalType }` with `raceWindows.ts` classifying goal into `GoalClass` and `feasibility.ts` projecting VDOT gains. Cycling events are more varied, so generalize `races` into a discipline-tagged **events** model (add `sport` to `races`, or a sibling `events` table sharing the enum).

### 5.1 Event types and their target semantics

| Event kind | Analogous to | Target field(s) | Feasibility axis |
|---|---|---|---|
| **Gran fondo / road race** | marathon (endurance) | `distanceMeters` + `elevationGainMeters` + target time | can you sustain the required avg power / TSS budget for the duration? |
| **Time trial (TT)** | 10k/half (threshold effort) | `distanceMeters` or `durationSeconds` + **target avg power** | required IF for the duration vs. FTP (§5.3) |
| **Stage race** | multi-race block | list of daily events + total TSS budget | repeatability: daily TSS vs. CTL / durability |
| **FTP goal** | a time-goal PR (no race) | **target FTP (W or W/kg)** by a date | pure fitness projection (§5.3) — the cleanest analog of a goal-time |
| **Crit / mass start** | track race | duration + repeated anaerobic surges | anaerobic capacity (W′), less FTP-bound |

New/added columns on the event row: `sport`, `elevationGainMeters`, `targetPowerWatts`, `targetFtpWatts` (for FTP-goal events), `durationSeconds` (for fixed-duration TTs). The existing `priority` (goal/tune_up/training), `purpose`, `status`, `resultTimeSeconds` all carry over; add `resultAvgPowerWatts` / `resultFtpWatts`.

### 5.2 Periodization windows (`raceWindows.ts` analog)

`classifyGoal` → a `classifyEvent` returning an event class (`endurance_fondo | time_trial | stage | ftp_goal | crit`) that drives `QUALITY_EMPHASIS` (the per-class × phase zone-rotation table in `generate.ts`). Cycling emphasis, e.g.:
```
time_trial:     base:[sweetspot], build:[threshold, sweetspot], peak:[threshold, vo2max], taper:[threshold]
endurance_fondo: base:[endurance], build:[sweetspot, tempo],     peak:[tempo, threshold],  taper:[endurance]
ftp_goal:        base:[sweetspot], build:[threshold, sweetspot], peak:[vo2max, threshold], taper:[threshold]
```
Tune-up races (crits/local TTs) get the same mini-taper machinery in `periodize.ts:applyKeyRaces` — unchanged.

### 5.3 Feasibility & goal-tracker (`feasibility.ts` analog)

`feasibility.ts` projects realistic VDOT gain (`typicalWeeklyVdotGain` diminishing with fitness, season cap, taper weeks) and predicts race-day time. The cycling twin projects **FTP gain**:
- `typicalWeeklyFtpGain(ftp, weightKgTrend)` — beginners gain ~1–2% FTP/week, trained riders far less; diminishing-returns curve mirroring `typicalWeeklyVdotGain`. Express gains in **%FTP** (or W/kg), which is the natural fitness axis.
- **FTP-goal event:** directly compare `goalFtp` vs. `projectedFtp = ftp + achievableGain` → the same `ahead/on_track/stretch/unrealistic` verdicts, verbatim logic.
- **TT event:** the required average power for the target time; the "predicted time" step needs a **power→speed model** instead of `predictRaceTimeSeconds`. This is the one piece with **no clean VDOT analog** — flat-TT time depends on aerodynamics (CdA), mass, gradient, air density, not just FTP. Options: (a) require the athlete to input a CdA / recent TT baseline and scale by power ratio; (b) restrict v1 feasibility to power-based verdicts ("you can hold the required 280 W? yes/no") and defer time prediction. **Recommend (b) for v1** — flag physics model as a follow-up.
- **Fondo/stage:** feasibility is a **TSS-budget / durability** question (can CTL support the day's TSS, can the rider repeat it), not a VDOT-style single-number projection. Reuse the PMC: does projected event-day CTL support the event's TSS demand with acceptable TSB?

**Goal-tracker implications:** the running goal tracker watches VDOT trend vs. goal VDOT. The cycling tracker watches **FTP trend** (from auto-anchoring, §1.4) vs. goal FTP, plus **CTL trend** vs. the event's TSS demand for endurance events. Both are already time-series-of-a-fitness-scalar — the tracker generalizes cleanly once the scalar is `FTP` instead of `VDOT`.

---

## 6. Mapping to the `DisciplineStrategy` interface

Story 0 defines the exact interface; this section designs `bikeStrategy` to a `{ anchor, zones, prescription, feasibility }` shape and flags what won't fit a naive shared interface.

### 6.1 Proposed shape (both sports implement)

```ts
interface DisciplineStrategy<Anchor, Zones, Config, Prescription> {
  sport: Sport;                                             // 'run' | 'bike'
  // --- anchor (VDOT | FTP) ---
  resolveAnchor(cfg: Config, global: GlobalModel): Anchor | null;   // getAthleteVdot | resolveFtp
  anchorFromActivity(a: Activity): Anchor | null;                    // bestEffort VDOT | CP-fit FTP
  // --- zones ---
  buildZones(anchor: Anchor, cfg: Config, global: GlobalModel): Zones; // buildZonesFromVdot | buildPowerZones
  // --- prescription (workout builder) ---
  prescribe(day: DayTemplate, dayVolume: number, zones: Zones, seed: number): PlannedDay; // generate.ts | bike generate
  // --- load ---
  targetLoad(p: Prescription, zones: Zones): number;               // planned TSS / target load
  actualLoad(a: Activity, anchor: Anchor, hr?: HrParams): LoadResult; // estimateLoad | bikeLoad
  // --- events / feasibility ---
  classifyEvent(e: Event): string;                                 // classifyGoal | classifyEvent
  feasibility(input: FeasibilityInput): GoalFeasibility;           // assessGoalFeasibility | bike twin
  emphasis: Record<EventClass, Record<Phase, ZoneKey[]>>;          // QUALITY_EMPHASIS analog
}
```

The shared, sport-agnostic machinery that **stays in the generic engine, unchanged**: `periodize.ts` (backward layout, phases, ramp, down-weeks, tune-up tapers), `fitnessFatigue.ts` (PMC), `banisterTrimp`, the plan-persistence glue, and the adapt/readiness loop (`adapt.ts`).

### 6.2 What fits cleanly

- **Anchor:** VDOT ↔ FTP — both a single scalar resolved global→athlete from an explicit value / test / activity. Clean 1:1.
- **Zones:** both are "anchor × per-zone bands → concrete zones", with per-athlete overrides + strength bias. Clean 1:1 (`buildZones`/`buildZonesFromVdot` ↔ `buildPowerZones`).
- **Prescription:** both are warm-up/work/cool-down segment builders with seed-rotated templates. Clean 1:1 (`WorkoutSegment` ↔ `BikeSegment`).
- **Load:** both fit the `estimateLoad` ladder (best signal → HR → volume, `estimated` flag). Clean once units reconciled.
- **Feasibility (FTP-goal & fitness-projection events):** clean 1:1 with `assessGoalFeasibility`.
- **Periodization & PMC:** shared, unit-agnostic. Clean.

### 6.3 What will NOT fit a naive shared interface — flags

1. **Volume unit mismatch (biggest).** `PlannedDay.distanceMeters`, `plans.weeklyTargetMeters`, `plannedSessions.targetDistanceMeters/targetPace*` are all **running-shaped**. Cycling needs `durationSeconds`, `targetPowerWatts`, `weeklyTargetTss`. Story 0 must abstract "weekly volume" and "session target" into discipline-tagged fields (recommend: `weeklyTargetLoad + loadUnit`, and a `target` jsonb per session or parallel `targetDuration*/targetPower*` columns). `PlannedDay` should hold a discriminated `prescription` payload, not a bare `distanceMeters`.

2. **PMC load-unit reconciliation (TRIMP vs. TSS).** See §4.4 — must be decided before any multi-sport athlete gets a shared CTL/ATL/TSB. Not an interface shape issue; a *data-currency* issue that the interface can't paper over.

3. **TT time prediction has no VDOT analog.** `predictRaceTimeSeconds` inverts a physiological relation for running; flat-TT time needs an aero/mass/gradient physics model (CdA). `feasibility()` for TTs should return power-based verdicts in v1 and leave time prediction `null` (flagged), or require a rider-supplied CdA/baseline.

4. **`sweetspot` is a non-partitioning band.** Running zones tile the pace axis; `sweetspot` overlaps `tempo`/`threshold`. Any code that assumes zones are mutually exclusive (e.g. "which single zone was this ride in") must treat sweet-spot as an alias, not a slice.

5. **Anaerobic/sprint work is duration-only, not TSS-scored.** TSS (a 4th-power-of-power aerobic metric) under-weights very short maximal efforts and ignores W′ depletion. Neuromuscular/anaerobic sessions should be prescribed and tracked by duration/reps, with load a rough add-on — the shared "everything has a TSS" assumption breaks at the top zones. Track W′/anaerobic capacity separately if crit/sprint athletes matter.

6. **Event cardinality.** Running assumes one goal race + tune-ups. **Stage races** are a *set* of daily events under one goal — the `races`/`KeyRace` model needs a parent-event or multi-day grouping, which `periodize.ts:applyKeyRaces` doesn't currently express.

---

## 7. Build plan — Stories 1–7

Estimates are rough (ideal-dev-days); all assume **Story 0 (discipline dimension) has landed**, giving us: `sport` on plans/planned_sessions, an abstracted weekly-volume scalar, and the `DisciplineStrategy` interface skeleton.

| Story | Deliverable | Depends on | Est. |
|---|---|---|---|
| **1. FTP anchor + `powerConfig`** | `engine/plan/powerConfig.ts` (types, `resolveFtp`, `ftpFrom*` incl. CP fit), `athletes.powerConfig` + `engine_settings.powerModel` columns, DB glue mirroring `db/paceConfig.ts`. **Includes the §4.4 PMC unit decision** (spike + choose A or B). | Story 0 | 3–4 d |
| **2. Power + HR zones** | `buildPowerZones`, `DEFAULT_POWER_ZONES`, `%LTHR` fallback, strength bias, `wattsLabel`/W-kg display. Unit tests par:ity with a known FTP. | 1 | 2 d |
| **3. TSS / load** | `tssFromPower` (NP/IF), `hrTss`, `estimatedTss`, `bikeLoad` ladder; wire cycling `activities.trainingLoad`; implement the chosen PMC reconciliation from Story 1. | 1, 2 | 3 d |
| **4. Workout library** | `BikeSegment`, `BikeQualityTemplate` set (endurance→sprint), seed rotation, embedded-work endurance rides, prose mirrors. | 2 | 3–4 d |
| **5. Generate + periodize wiring** | Cycling `generateWeek` (distribute weekly TSS → per-day duration@power), plug into the shared unit-agnostic `periodize.ts`; `QUALITY_EMPHASIS` per event class. | 3, 4 | 3 d |
| **6. Events + feasibility** | `events` model generalization (columns/enum), `classifyEvent`, `typicalWeeklyFtpGain`, FTP-goal/endurance feasibility verdicts, goal-tracker on FTP+CTL trend. (TT time-prediction deferred/flagged.) | 1, 5 | 3–4 d |
| **7. `bikeStrategy` assembly + adapt** | Implement the `DisciplineStrategy` for bike, register it behind the sport dispatch, run it through the existing `adapt.ts`/readiness loop, console engine-params editor for the power model. | 1–6 | 3 d |

**Critical path:** 1 → 2 → 3 → 5 → 7, with the **PMC unit reconciliation (§4.4) as the top de-risking item in Story 1** (it's the only decision that reaches back into the *running* code and affects every multi-sport athlete). Stories 4 and 6 can proceed in parallel with 3/5 once 2 lands. Total ≈ **20–24 dev-days**.

---

## Sources

- Allen, H. & Coggan, A., *Training and Racing with a Power Meter* — Coggan 7-zone %FTP model; Normalized Power (30 s rolling avg → 4th power → mean → 4th root); Intensity Factor = NP/FTP; TSS = (sec × NP × IF)/(FTP × 3600) × 100 = IF² × hours × 100; 20-min field test ×0.95; %LTHR HR zones. (Formulas summarized: [Goossens, "Formulas from Training and Racing with a Power Meter"](https://medium.com/critical-powers/formulas-from-training-and-racing-with-a-power-meter-2a295c661b46))
- Coggan power-zone boundaries (Z1<55%, Z2 56–75%, Z3 76–90%, Z4 91–105%, Z5 106–120%, Z6 121–150%, Z7 150%+): [atomicmetrix zones/FTP/power-curve guide](https://www.atomicmetrix.com/en/blog/zones-ftp-and-power-curve); [FTP test protocols guide](https://cyclingarchives.com/ftp-test-cycling-2026-complete-how-to-guide-coggan-friel-ramp-8-minute-protocols/)
- Ramp-test FTP = 0.75 × best 1-min power (TrainerRoad/Zwift convention); 8-min ×0.90 (Carmichael): [FTP test cycling guide](https://cyclingarchives.com/ftp-test-cycling-2026-complete-how-to-guide-coggan-friel-ramp-8-minute-protocols/); [TrainerRoad forum on Coggan zone start](https://www.trainerroad.com/forum/t/where-does-the-range-start-on-coggan-training-zones/103567)
- Critical Power 2-parameter model P(t) = W′/t + CP — Monod & Scherrer (1965); Jones et al. (CP ≈ FTP).
- Performance Manager Chart (CTL 42-day / ATL 7-day EWMA of TSS; TSB = CTL − ATL) — Coggan / TrainingPeaks. Matches `engine/fitnessFatigue.ts` (ctlTau=42, atlTau=7).
- Banister TRIMP (HR-reserve weighted, sex constants a=0.64/0.86, b=1.92/1.67) — already implemented in `engine/load.ts`; reused sport-agnostically for hrTSS.
- TSS = IF² × duration_hours × 100 and "1 h at FTP = 100 TSS" cross-checked: [cyclingregimen TSS calculator](https://cyclingregimen.com/tools/tss-calculator).

**Existing-code references (running engine mirrored):** `src/engine/plan/{types,vdot,zones,workouts,generate,periodize,feasibility,paceConfig,bestEffort,raceWindows,templates,index}.ts`; `src/db/{paceConfig,schema}.ts`; `src/engine/{load,fitnessFatigue}.ts`.
