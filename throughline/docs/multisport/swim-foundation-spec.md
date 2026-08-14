# Swim Foundation Spec — the SWIM leg (`swimConfig` + `swimStrategy` + CSS anchor)

**Status:** design only, no code. **Date:** 2026-08-14.
**Mirrors:** how cycling's FTP landed — `engine/plan/ftpLogic.ts` (anchor + estimators + resolver), `db/powerConfig.ts` (jsonb glue), `engine/plan/powerZonesLogic.ts` (zones-from-anchor), `engine/plan/bikeStrategy.ts` (seam wiring).
**Builds on:** the unified load currency (`engine/loadCurrencyLogic.ts`), the cross-sport transfer model (`engine/transferLogic.ts`), the `DisciplineStrategy` seam (`engine/plan/strategy.ts`).

---

## 0. Why swim is the biggest missing piece

The unified currency already has a **swim rung** — `stss()` in `loadCurrencyLogic.ts:225` and the `swim` case in `estimateLoadTss()` (`loadCurrencyLogic.ts:393`). But that case reads `anchors.cssMetersPerSec`, and **nothing populates it**. `LoadAnchors.cssMetersPerSec` (`loadCurrencyLogic.ts:320`) is declared and never sourced, so every swim today drops to the `estimatedTss` fallback (`confidence: 'estimated'`, `lowConfidence: true`) — a flat duration×IF guess. The transfer model already has a full **swim target row and swim source columns** (`transferLogic.ts:129–138`, plus `swim` cross-terms in the run/bike rows), so the moment swim produces real `css`-confidence load, cross-sport readiness and the tri allocator light up.

The whole swim leg is therefore **one missing anchor and its plumbing**: a `swimConfig` source for CSS, a zones-from-CSS builder, the seam wiring, and a workout library. Everything downstream (currency rung, transfer coefficients, PMC, adaptation) is already built and waiting. This is the exact shape cycling had after Story 0/1 — the seam and the load rung existed; the anchor source and library did not.

**Prerequisite type fix:** `Discipline` in `engine/plan/types.ts:43` is currently `'run' | 'bike'`. The transfer model's `Discipline` (`transferLogic.ts:64`) is already `'run' | 'bike' | 'swim'`. Adding `'swim'` to the plan-engine union is the first, trivial change; `selectStrategy()` (`strategy.ts:100`) must gain a `case 'swim'`.

---

## 1. The CSS anchor — the VDOT/FTP analog

### 1.1 What CSS is

**Critical Swim Speed (CSS)** is the swim threshold: the fastest velocity an athlete can hold in a quasi-steady state, the swim analog of running threshold pace and cycling FTP. It is the y-of-the-asymptote of the swimmer's distance–time (velocity–duration) curve — the *critical velocity* from the two-parameter critical-power model applied to swimming.

CSS is derived from two maximal time trials at different distances:

```
CSS (m/s) = (D_long − D_short) / (T_long − T_short)
```

The canonical protocol is **400 m and 200 m** all-out time trials on the same day (after warm-up, full recovery between):

```
CSS (m/s) = (400 − 200) / (T400_sec − T200_sec)          — Wakayoshi et al. 1992; Ginn 1993
```

This is literally cycling's `criticalPowerFit()` (`ftpLogic.ts:120`) — a two-point linear fit of the distance–time line whose slope is critical velocity — but with only two points and closed-form, because the swim protocol fixes the two distances. **Store CSS internally as m/s**, exactly matching `SwimSession.cssMetersPerSec` (`loadCurrencyLogic.ts:213`) and `LoadAnchors.cssMetersPerSec`, so no unit conversion is needed at the load boundary. (Coaches read swim pace as **sec/100 m**; `100 / cssMetersPerSec` is the CSS pace in sec/100 m for display — the swim analog of `wattsLabel`/W-kg.)

### 1.2 `swimConfig` jsonb — the mirror of `paceConfig` / `powerConfig`

Add an `athletes.swimConfig` jsonb column and an `engine_settings.swimModel` global row, exactly as cycling added `athletes.powerConfig` + `engine_settings.powerModel`. Two-level customization: global model defaults → per-athlete overrides → effective zones.

```ts
// engine/plan/cssLogic.ts  (the ftpLogic.ts twin — pure, DB-free, no server-only)

/** A raw swim test to derive CSS from. */
export interface SwimTest {
  kind: 'css_400_200' | 'css_two_distance' | 'time_trial' | 'velocity_curve';
  // css_400_200 (canonical):
  t400Sec?: number;
  t200Sec?: number;
  // css_two_distance (generic Wakayoshi two-point, e.g. 400/50 per Swim Smooth):
  dLongMeters?: number;  tLongSec?: number;
  dShortMeters?: number; tShortSec?: number;
  // time_trial (single all-out effort → CSS via a duration-discount factor):
  ttDistanceMeters?: number; ttTimeSec?: number;
  // velocity_curve (≥2 distinct maximal efforts → least-squares critical velocity):
  curve?: Array<{ distanceMeters: number; timeSec: number }>;
  poolCourse?: 'scm25' | 'lcm50' | 'scy25';  // provenance; see §6 open questions
  date?: string;
}

/** OVERALL swim model (global default; coach tunes once). engine_settings.swimModel. */
export interface GlobalSwimModel {
  zones: SwimZoneModel;              // per-CSS pace-offset bands (§2)
  // single-TT → CSS discount factors (tunable, the twin of ramp/20-min factors):
  ttFactorByDurationSec?: Array<{ maxDurationSec: number; factor: number }>;
  // default: a ~400 m TT ≈ CSS×1.0 (near-threshold); a 1500 m TT ≈ CSS×~0.97;
  //          a 100 m TT ≈ CSS×~1.10 (well above threshold) — discount toward CSS.
}

/** INDIVIDUAL athlete swim config; every field optional, layered on the global. */
export interface AthleteSwimConfig {
  // --- fitness anchor (provide one; resolution order in resolveCss) ---
  cssMetersPerSec?: number;         // explicit CSS (wins)
  swimTest?: SwimTest;              // a raw test to derive CSS from
  // --- provenance (identical semantics to paceConfig.anchorSource) ---
  anchorSource?: 'auto' | 'manual';
  // --- per-athlete overrides layered on the global model ---
  bandOverrides?: Partial<SwimZoneModel>;             // custom per-CSS offsets
  zoneOverrides?: Partial<Record<SwimZoneKey, SwimZoneOverride>>; // final sec/100 nudges
  // --- stroke/technique bias (the strengthBias analog) ---
  // + = fast/anaerobic (sprint-biased); − = diesel/aerobic (distance-biased).
  strengthBias?: number;            // [-1, +1]
  // --- environment defaults ---
  defaultEnvironment?: 'pool' | 'open_water';         // see §6
  openWaterOffsetSecPer100?: number;                  // learned/entered OW penalty (§6)
}
```

### 1.3 CSS estimation methods (the `ftpFrom*` / `vdotFrom*` analogs)

A family of pure `cssFrom*` estimators, dispatched by `cssFromTest()`, exactly mirroring `ftpFromTest()` (`ftpLogic.ts:157`):

- **`cssFrom400_200(t400, t200)`** — `(400 − 200) / (t400 − t200)`. The canonical Wakayoshi/Ginn anchor. Highest confidence.
- **`cssFromTwoDistance(dL, tL, dS, tS)`** — generic two-point critical velocity `(dL − dS)/(tL − tS)`. Supports the Swim Smooth 400/50 variant and any two efforts.
- **`cssFromVelocityCurve(curve)`** — ≥2 distinct maximal efforts, least-squares fit of `D = CV·T + d0` (distance-linear form of the CP model), slope = critical velocity. The direct swim twin of `criticalPowerFit()`; returns null on <2 distinct distances (fit under-determined), same guard as cycling.
- **`cssFromTimeTrial(dist, time, factors)`** — single all-out effort discounted toward CSS by a duration-dependent factor (short TT overshoots CSS, long TT ≈ CSS). The twin of `ftpFromRamp`/`ftpFromTwentyMin`'s single-effort multipliers. Lower confidence; flagged for a proper two-point retest.

```ts
export function resolveCss(
  config: AthleteSwimConfig,
  global: GlobalSwimModel = DEFAULT_GLOBAL_SWIM_MODEL,
): number | null {
  if (config.cssMetersPerSec != null) return config.cssMetersPerSec;   // explicit wins
  if (config.swimTest) return cssFromTest(config.swimTest, global);     // test-derived
  return null;                                                          // no anchor
}
```

Precedence — explicit → test-derived → null — is byte-for-byte `resolveFtp()` (`ftpLogic.ts:198`) and `getAthleteVdot`. As on the pace/power side, **the anchor is taken directly from the fitness signal, never re-derived from the (bias/override-carrying) zones.** Null means "no CSS": the load rung falls back to `estimatedTss` (there is deliberately **no HR fallback for swim** — see §4).

### 1.4 DB glue — `db/swimConfig.ts` (the `db/powerConfig.ts` twin)

```ts
getAthleteCss(db, athleteId): Promise<number | null>      // resolveCss(swimConfig, globalSwimModel)
getGlobalSwimModel(db): Promise<GlobalSwimModel>
setGlobalSwimModel(db, model)
setAthleteSwimConfig(db, athleteId, config)
getAthleteSwimZones(db, athleteId): Promise<SwimZones | null>   // try resolveSwimZones, else null
```

`getAthleteCss` is the value that finally populates `LoadAnchors.cssMetersPerSec` at the load-computation call site (wherever `estimateLoadTss` is invoked for a swim activity) — the single wire that turns swim load from `estimated` into `css` confidence. This mirrors how `getAthleteFtp` (`db/powerConfig.ts:24`) feeds `anchors.ftpWatts`.

---

## 2. Swim pace zones from CSS — the `powerZonesLogic.ts` analog

### 2.1 Zone model

Cycling zones are **%FTP** (multiplicative watt bands). Swim zones are conventionally expressed as **sec/100 m offsets from CSS pace** (additive, in the pace domain) — the Swim Smooth / Friel CSS-zone convention. This matches how the run engine already thinks in `sec/km` offsets from threshold (`zones.ts` `offsets`), so swim reuses the *pace-offset* mental model, not the *%-of-anchor* one. Internally CSS is m/s; convert once to CSS pace `p_css = 100 / cssMetersPerSec` (sec/100 m), then each band is `p_css + offset`.

```ts
export type SwimZoneKey =
  | 'recovery'    // very easy, technique/warm-up
  | 'aerobic'     // endurance / long-set base
  | 'threshold'   // at/around CSS (the anchor band)
  | 'vo2max'      // ~race pace for short course, above CSS
  | 'sprint';     // 25/50 speed work, well above CSS

/** Per-zone sec/100 m offset from CSS pace (fast = negative). */
export type SwimZoneModel = Record<SwimZoneKey, { loOffset: number; hiOffset: number }>;

export const DEFAULT_SWIM_ZONES: SwimZoneModel = {
  recovery:  { loOffset: +10, hiOffset: +20 },  // CSS + 10–20 s/100
  aerobic:   { loOffset: +4,  hiOffset: +10 },  // CSS + 4–10 s/100
  threshold: { loOffset: -2,  hiOffset: +2  },  // CSS ± 2 s/100  (the anchor)
  vo2max:    { loOffset: -6,  hiOffset: -2  },  // CSS − 2–6 s/100
  sprint:    { loOffset: -12, hiOffset: -6  },  // CSS − 6 s/100 and faster
};
```

(Offsets are defensible Swim-Smooth-style starting values, tunable global→athlete exactly like `DEFAULT_POWER_ZONES` and `GlobalPaceModel`.) The output shape is a tagged `SwimZones` carrying `kind: 'swim'`, mirroring `PowerZones` `kind: 'power'`, so it slots into the generalized `TrainingZones` union (`types.ts:118`) alongside `PaceZones`/`PowerZones` with an `isSwimZones()` narrow.

```ts
export interface SwimZones {
  kind: 'swim';
  cssMetersPerSec: number;
  cssPaceSecPer100: number;             // 100 / cssMetersPerSec, for display
  zones: Record<SwimZoneKey, { fastSecPer100: number; slowSecPer100: number }>;
}
```

### 2.2 `resolveSwimZones` and `strengthBias`

`resolveSwimZones(config, global)` mirrors `resolvePowerZones` (`ftpLogic.ts:213`): resolve CSS, throw only if no anchor, build bands, apply `strengthBias` (sprint-biased widens/faster on `sprint`/`vo2max`, slower on `aerobic`; distance-biased the reverse — the swim McMillan analog), then apply final per-zone `zoneOverrides`. Unlike cycling there is **no HR fallback path** (§4), so "no CSS anchor" simply yields null zones (prescribe by RPE/perceived effort until a test exists), rather than dropping to a %LTHR arm.

---

## 3. sTSS activation in the load currency

The rung already exists. `stss()` (`loadCurrencyLogic.ts:225`) computes `IF = swimSpeed / CSS`, clamped at `MAX_SWIM_IF = 1.1` (`loadCurrencyLogic.ts:68`), then `load = IF² × hours × 100` via the shared `loadFromIntensity()` kernel — identical to run rTSS and bike TSS. The `swim` dispatch case (`loadCurrencyLogic.ts:393`) already:

1. derives swim speed from `swimSpeedMetersPerSec` or `distanceMeters / durationSeconds`;
2. calls `stss()` when `anchors.cssMetersPerSec != null && speed > 0` → `confidence: 'css'`;
3. otherwise goes straight to `estimatedTss` (deliberately skipping hrTSS).

**So the only activation work is sourcing `anchors.cssMetersPerSec` from `getAthleteCss(db, athleteId)`** at the swim load-computation call site — the same wiring cycling did for `ftpWatts`. No new load code. Once wired, swim climbs the confidence ladder from `estimated` (soft, `lowConfidence`) to `css` (hard), which the transfer model and allocator then treat as trustworthy currency.

Planned (not-yet-completed) swim sessions have no speed stream, so they price via `estimatedTss` with the session's `zone` → `zoneIf()` (`loadCurrencyLogic.ts:96`); note the swim zone keys (§2.1) must map into the shared `ZONE_IF` table (`loadCurrencyLogic.ts:81`) so a planned `threshold` swim gets IF≈0.98, a planned `aerobic` swim IF≈0.65, etc. This is the swim analog of how planned bike/run sessions price before they're executed.

---

## 4. Slotting swim into the `DisciplineStrategy` seam

`swimStrategy` is a full `DisciplineStrategy` (`strategy.ts:42`), the exact mirror of `bikeStrategy`:

| Method | Swim implementation | Mirrors |
|---|---|---|
| `discipline` | `'swim'` | `bikeStrategy.discipline = 'bike'` |
| `resolveFitnessAnchor(config)` | `resolveCss(config)` → CSS (m/s) | `resolveFtp` → FTP |
| `resolveZones(config, global)` | `resolveSwimZones` → `SwimZones` | `resolvePowerZones` → `PowerZones` |
| `buildQualitySegments(...)` | CSS-relative interval sets (§5) | bike power intervals (still stubbed) |
| `buildQualityDescription(...)` | one-line prose ("10×100 @ CSS, 15 s rest") | bike prose |
| `assessGoalFeasibility(input)` | CSS-improvement + swim-volume model | FTP/CTL model |

`selectStrategy()` (`strategy.ts:100`) gains `case 'swim': return swimStrategy;`. Because the seam's `buildQuality*` signatures are currently pace-shaped (`PaceZones`, `workMiles`, `WorkoutSegment` in meters), the multi-discipline generalization the cycling spec flagged (its §6.3 — a discriminated `prescription` payload) must land for swim's sets to be first-class; until then swim can prescribe via the segment `note` + description path, same interim the bike takes.

**Transfer model — already done.** `swimStrategy` needs no transfer work: `transferLogic.ts` already has the `swim` **target** row (`swim→swim` identity `{1,1,1}`, `run→swim`/`bike→swim` central ≈0.25 — `transferLogic.ts:129`) and swim as a **source** in the run/bike rows (`swim→run` central 0.60 flagged for review at `transferLogic.ts:114`; `swim→bike` central 0.40 at `:124`). Real `css`-confidence swim load flowing into `computeFitnessTracks()` immediately produces honest central-aerobic carry into run/bike tracks (discounted, no economy/durability) and a genuine `central:swim` / `specific:swim` PMC pair via `trackId()` (`transferLogic.ts:244`). The `swim→run` 0.60 coefficient is the one number worth revisiting with the guinea-pig cohort's data.

---

## 5. Swim workout library — the `workouts.ts` analog

A `SwimSegment` + `SwimQualityTemplate` set (the mirror of the pending cycling `BikeSegment`/`BikeQualityTemplate`), each with warm-up → main set → cool-down, seed-rotated for deterministic weekly variation. Swim's distinctive feature vs. run/bike: **technique/skill work is a first-class session type**, not an afterthought — because (per the tri spec §3.4) swim's *fitness*-yield per hour is low but its *time*-yield per hour is high when technique is the limiter, so the library must carry drill/skill sets as their own category.

Library categories (CSS-relative unless noted):

- **CSS / threshold sets** (the anchor workout): `10×100 @ CSS, 10–15 s rest`; `8×200 @ CSS+2, 20 s`; `broken 400s (4×100 @ CSS-1, 10 s)`. Aerobic power at threshold.
- **VO2 / race-pace**: `20×50 @ CSS-4, 15 s`; `8×100 @ CSS-3, 30 s`. Short-course sharpening.
- **Aerobic endurance / long pull**: continuous `1500–3000 m @ CSS+6–10`; `3×800 @ CSS+5`; pull-buoy sets. The long-run analog.
- **Technique / drill sets** (own category — the swim differentiator): catch-up, single-arm, sculling, 6-kick-switch, fingertip drag, distance-per-stroke ("golf": stroke-count + time), band-only. Prescribed by *frequency*, not load — per Friel, swim skill responds to frequency over duration.
- **Speed / sprint**: `12×25 max, full recovery`; `50s @ sprint`. Neuromuscular; under-weighted by the aerobic kernel (flag `lowConfidence`, same as cycling sprints — `loadCurrencyLogic.ts:52`).
- **Open-water-specific** (see §6): sighting every N strokes, drafting, pack-start surges, non-wall continuous swims.

Each template emits segments whose per-100 pace comes from the athlete's own `SwimZones` (never absolute times), exactly as the run library emits reps at the athlete's own paces. Prose mirror in the coach's format, e.g. *"Warm-up 400 mixed; main 10×100 @ 1:38/100 (CSS) w/ 15 s; 200 easy."*

---

## 6. Open questions & flags

1. **Pool vs. open water.** CSS is measured and prescribed in a **pool** (walls, known distance, no navigation). Open-water swims (the actual race environment for the June-2027 cohort) run **~5–10 s/100 m slower** from sighting, navigation, chop, and no push-offs — partly offset by wetsuit buoyancy in cold water. Proposal: `defaultEnvironment` + a learned/entered `openWaterOffsetSecPer100` on `swimConfig`; OW swims price sTSS against an *effective* CSS shifted by that offset so IF stays honest, and the OW penalty itself is a limiter signal the tri allocator can act on. Do **not** let raw OW pace deflate the pool-measured CSS anchor.
2. **No-watch swims.** Many athletes (and pools) swim without a device, so no speed stream → sTSS falls to `estimatedTss`. Provide **manual entry** (total distance from length-count + total time + RPE, or a set list) that reconstructs `distanceMeters`/`durationSeconds` for the `stss()` path, and let RPE nudge the assumed zone. This is the swim analog of a manually-logged run; without it, swim load silently stays soft.
3. **Units: meters vs. yards.** Short-course *yards* (SCY, US pools) vs. *meters* (SCM/LCM). Store `poolCourse` on tests/activities; convert yards→meters at ingest so CSS is always m/s. A 400 SCY TT is not a 400 SCM TT — the conversion must happen before the two-point fit.
4. **No swim HR path — by design.** Swim HR is unreliable (water pressure, breath-hold, poor wrist-optical contact), so the dispatch deliberately skips `hrTss` for swim (`loadCurrencyLogic.ts:400`). Consequence: an athlete with no CSS and no device gets only `estimated` swim load. This makes the **CSS test the gating onboarding step** for any swim-carrying plan — surface it as a required setup action, the way FTP is for cycling.
5. **CSS retest cadence / drift.** CSS improves fastest early (technique unlocks), so `anchorSource: 'auto'` should re-derive from recent maximal efforts while `'manual'` stays pinned — identical semantics to `paceConfig.anchorSource` (`paceConfig.ts:55`). Recommend a retest every 6–8 weeks during build.
6. **`swim→run` transfer coefficient (0.60).** Higher than the spec's 0.30–0.50 band (`transferLogic.ts:114`); flagged there for review. The guinea-pig cohort's swim-heavy weeks are the natural dataset to tune it.

---

## Sources

- **Wakayoshi, K. et al. (1992)** — Critical Swim Speed as the swimming analog of critical velocity/critical power; `CSS = (D2−D1)/(T2−T1)`. The swim threshold anchor.
- **Ginn, E. (1993)** — 400/200 m two-point CSS protocol; the practical field test.
- **Monod & Scherrer (1965); Jones et al.** — two-parameter critical-power model `P(t)=W′/t + CP` (CP ≈ threshold), the general form the swim velocity-curve fit and cycling's `criticalPowerFit()` both instantiate.
- **Swim Smooth (CSS training-pace methodology)** — CSS-relative pace zones as sec/100 m offsets; the 400/50 test variant; CSS-interval main sets.
- **Friel, J., *The Triathlete's Training Bible* (4th ed.)** — swim skill responds to *frequency* over duration; technique work as a first-class session; limiter-driven swim emphasis.
- **Coggan, A. / TrainingPeaks** — TSS = IF² × hours × 100, "one hour at threshold = 100"; the shared kernel `stss()` reuses (`loadCurrencyLogic.ts:104`).
- **Existing-code references (composed/extended, not modified):** `src/engine/loadCurrencyLogic.ts` (`stss`, `estimateLoadTss` swim case, `LoadAnchors.cssMetersPerSec`, `MAX_SWIM_IF`); `src/engine/transferLogic.ts` (swim target row + swim source terms); `src/engine/plan/{strategy,ftpLogic,powerZonesLogic,paceConfig,types}.ts`; `src/db/{powerConfig,paceConfig}.ts`.
