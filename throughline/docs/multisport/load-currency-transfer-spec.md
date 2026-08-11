# Load-Currency Unification + Cross-Sport Fitness Transfer — Design Spec

**Status:** Design + sports-science research only. **No code changes. Do not touch prod / `DATABASE_URL`.**
**Author scope:** the foundational block that gates (a) cycling periodization and (b) the whole triathlon time-optimization allocator.
**Builds on:** `cycling-engine-spec.md` §4.4 (flagged the TRIMP-vs-TSS reconciliation as *"the single most important cross-discipline decision in the whole refactor"*) and `triathlon-time-optimization-spec.md` §7.4 + story **T0** (its allocator *requires* a unified currency and states the decision "must land on the TSS-equivalent side"). This doc **is** T0: it makes the decision, specifies every formula, and designs the migration + transfer model those two specs assume already exists.

---

## 0. TL;DR / decision

1. **Adopt Option A from cycling-spec §4.4:** move the PMC off Banister TRIMP onto a **TSS-equivalent currency** that every sport produces the *same way* — `Load = IF² × hours × 100`, where `IF` (intensity factor) is the sport's threshold-relative intensity. 100 = one hour at threshold, in every sport. This makes daily loads **summable onto one PMC** (which `insights.ts` already sums across sports today — see §1.5).
2. **Keep the PMC math unchanged** (`fitnessFatigue.ts`: CTL τ≈42d, ATL τ≈7d EWMA, TSB=CTL−ATL). Only the *numbers fed in* change, so the curve's **shape is preserved and the axis is renumbered**.
3. **Backfill** `activities.trainingLoad` in the new currency and **recalibrate** the `form` thresholds in `server/fitness.ts` (§2). Magnitude shift is quantified in §2.3 so we can pick defensible new thresholds before shipping.
4. **Split fitness into a transferable central-aerobic component and sport-specific tracks** (§3). The single summed PMC becomes the *central-aerobic* curve; per-discipline "specific fitness" tracks ride alongside it. Readiness/feasibility consult **central for aerobic capacity, sport-specific for durability** — so a big bike engine never overstates run readiness.
5. **Impact-substitution becomes a first-class athlete/coach setting** (§4), reusing `injuryRecords.allowedModalities` + the `monitor.ts` / `adaptation.ts` loop, with honest durability-tradeoff flagging and a mandatory run-specific ramp before race day.
6. **This is a hard prerequisite.** Cycling periodization (cycling-spec Stories 3+) and the triathlon allocator (tri-spec T4) are both incorrect until this lands. Ship behind a flag with **explicit owner sign-off** (§2.4).

---

## 1. Unified load currency

### 1.1 The problem, precisely

Today `engine/load.ts:estimateLoad` returns **Banister TRIMP** when HR is present (`banisterTrimp = durMin × HRr × a × e^(b·HRr)`, men a=0.64/b=1.92, women a=0.86/b=1.67) and a raw `durMin × 0.7` volume proxy otherwise (flagged `estimated`). `server/fitness.ts` and `server/insights.ts` both feed that number straight into `computeFitnessFatigue`.

TRIMP units are **arbitrary and open-ended** (a hard hour ≈ 100–150; there is no natural "100 = threshold hour" anchor), whereas cycling's newly-landed power path produces **TSS**, where **100 = 1 h at FTP by construction**. These are different scales with different intensity weightings (TRIMP is exponential in HRr; TSS is quartic in power). **Summing raw TRIMP + raw TSS into one CTL is physiologically meaningless** and corrupts every multi-sport athlete's fitness/fatigue/form. Both prior specs flag this as *the* blocking decision.

### 1.2 The unifying identity

Every sport computes the **same number the same way**:

```
Load (TSS-equivalent) = IF² × durationHours × 100
```

where `IF` = *intensity factor* = (athlete's sustained intensity for this session) ÷ (their threshold intensity for that sport). The only sport-specific part is **how you measure "intensity" and "threshold."** By anchoring every sport to *its own physiological threshold*, the resulting number is dimensionless-per-hour and **directly comparable and summable** across sports:

- **1.0 h at threshold → IF=1.0 → Load=100**, in run, bike, and swim alike.
- A 2 h ride at IF 0.75 → `0.75² × 2 × 100 = 112`. A 45 min threshold run → `1.0² × 0.75 × 100 = 75`. These now add: **187** total onto one PMC, and that sum *means* "1.87 threshold-hours of systemic aerobic stress today."

This is exactly the Coggan TSS definition generalized. Coggan's canonical form is `TSS = (sec × NP × IF)/(FTP × 3600) × 100`, which algebraically **equals** `IF² × hours × 100` because `NP/FTP = IF` (Allen, Coggan & McGregor, *Training and Racing with a Power Meter*, 3rd ed., ch. 7). We keep the `IF² × hours × 100` form as the shared kernel and let each sport supply IF.

> **Note on the squared term.** The `IF²` weighting is what makes intensity cost more than volume (a core, harder-hour reality). It is an aerobic-metabolic model and, like all TSS variants, **under-weights very short maximal / anaerobic efforts** (cycling-spec §4.4 caveat 5). Neuromuscular sprint work should carry a duration-based load with a small TSS add-on, not be scored purely on this kernel. Flag such sessions `lowConfidence`.

### 1.3 Per-sport IF derivation (the four rungs of one ladder)

Each rung produces the identical output field so they're interchangeable and summable. Present-data rungs are `estimated:false`; fallbacks are `estimated:true`.

#### (a) Cycling — **TSS** from power (primary). *Already landed on main.*

- **Normalized Power (NP):** 30-second rolling average of power, each value raised to the 4th power, averaged, 4th-root:
  `NP = ( mean( rolling30s(power)^4 ) )^(1/4)`. (Allen & Coggan.) The 30 s window + 4th power model the quasi-quartic relationship between power and physiological cost (lactate/glycogen), so variable rides cost more than their simple average implies.
- **IF = NP / FTP.** FTP comes from `db/powerConfig.ts:getAthleteFtp` (the fitness anchor, never re-derived from tweaked zones).
- **TSS = IF² × hours × 100.** Calibration confirmed in cycling-spec §4.1: 1 h @ FTP → IF 1.0 → TSS 100.
- Source: Allen, Coggan & McGregor (2019); TrainingPeaks TSS/NP/IF documentation.

#### (b) Running — **rTSS** from pace / GAP (primary). *New running-side change — the Story-0 dependency.*

- **Threshold pace** `T` (sec/km) from the athlete's VDOT anchor (`db/paceConfig.ts:getAthleteVdot` → threshold pace via `engine/plan/vdot.ts`). VDOT's "threshold/T pace" ≈ velocity at ~ lactate threshold / ~1-hour race pace (Daniels, *Daniels' Running Formula*, 3rd ed.).
- **GAP (Grade-Adjusted Pace):** adjust actual pace for elevation so hills count correctly. We already have `engine/plan/gap.ts` and `activities.elevationGainMeters` / per-split `elevDiffMeters`. GAP converts hilly pace to the equivalent flat pace using a grade→cost polynomial (Minetti et al., 2002, *J Appl Physiol*, running energy cost vs. gradient; Strava's GAP is the productized form). **Use GAP, not raw pace,** so a hilly easy run isn't scored as slow/easy.
- **Normalized Graded Pace (NGP):** TrainingPeaks' running analog of NP — a variability-weighted GAP over the session (short-interval surges cost more). Where per-split/lap streams exist (`activities.splits` / `laps`), compute NGP; otherwise fall back to session-average GAP.
- **IF = NGP_speed / threshold_speed** = `T / NGP_pace` (work in speed so faster→higher IF). Clamp to a sane ceiling (≈1.15) for short reps.
- **rTSS = IF² × hours × 100.** Source: TrainingPeaks rTSS/NGP methodology (Rick Loek / TrainingPeaks docs); grade cost from Minetti et al. (2002).
- This is a **small, well-defined change that touches the existing running load path** — call it out and gate it (§2.4).

#### (c) Swimming — **sTSS** from CSS (primary). *New; the swim rung.*

- **CSS (Critical Swim Speed):** the swim analog of threshold, from two time trials (classically 400 m and 200 m): `CSS_speed = (D400 − D200) / (t400 − t200)`. It estimates the swim speed sustainable ~indefinitely aerobically. Source: **Wakayoshi et al. (1992)**, *Eur J Appl Physiol* — "critical swimming velocity" as a non-invasive lactate-threshold surrogate; widely productized (Swim Smooth, TrainingPeaks).
- **IF = swimSpeed / CSS** for the session (average speed; use per-lap where available, capped ~1.1).
- **sTSS = IF² × hours × 100.** This is exactly the form tri-spec §2.3 / §7.4 specifies (`sTSS = IF² × hours × 100`, IF = swimSpeed/CSS). CSS anchors per-100 m pace bands just as threshold pace anchors run zones and FTP anchors power zones — a clean `DisciplineStrategy` instance.

#### (d) Any sport, HR present but no power/pace quality — **hrTSS** (fallback, `estimated:true`)

- Reuse `banisterTrimp` **verbatim** (it's sport-agnostic) and **rescale to the TSS anchor** so a threshold hour = 100:
  `hrTSS = TRIMP(session) / TRIMP(1 h @ threshold-HR) × 100`.
  where `TRIMP(1 h @ threshold-HR)` is computed once per athlete from their LTHR (bike/run) using the same Banister function → this is the **conversion constant that maps existing TRIMP onto the TSS axis** (also drives the backfill, §2).
- If HR-zone time-series exist, TrainingPeaks' zone-weighted hrTSS is a refinement, but the single-number rescale is sufficient and matches what we already store (`activities.avgHr`).
- Flagged `estimated:true` — HR lags and saturates (cardiac drift inflates late-session HR; it under-reads short intervals).

#### (e) No quality data at all — **estimated TSS** from duration × assigned IF (fallback, `estimated:true`)

- For a **completed** activity with only duration: `Load = IF_assumed² × hours × 100` with a conservative endurance IF (≈0.65 → ~42/h, close to the current `durMin×0.7`=42/h volume proxy, so the fallback barely moves — see §2.3).
- For a **planned** session (which never has HR yet): assign the target zone's nominal IF — endurance 0.65, tempo 0.82, sweet-spot 0.90, threshold 0.98, VO2max 1.05 (cycling-spec §4.2) — giving each prescription a `targetLoad` before it's done. This is how the periodizer and allocator get planned TSS.

### 1.4 One function, one output shape

All five rungs return the existing `LoadResult { load, estimated }`, so `activities.trainingLoad` stays the single common-currency column and downstream code is untouched in shape. The dispatch is a thin `sport`-switch layered on today's `estimateLoad`:

```
estimateLoad(session, anchors) → LoadResult
  bike:  power? tssFromPower(NP,FTP)          : hr? hrTSS : estimatedTss(zone)
  run:   pace/splits? rTSS(NGP|GAP, Tpace)    : hr? hrTSS : estimatedTss(zone)
  swim:  pace? sTSS(speed, CSS)               :           estimatedTss(zone)   // swim HR unreliable
  other/strength/cross_train: estimatedTss(zone|duration) + lowConfidence
```

`anchors` = `{ ftp?, thresholdPaceSecPerKm?, css?, lthr?, hrParams? }`, resolved from the existing `powerConfig` / `paceConfig` / (new) `swimConfig` glue. **Confidence ladder** per session: `power|pace|css` (true) > `hr` (estimated) > `zone/duration` (estimated, lowConfidence). Persist the tier so the coach UI and the allocator can discount low-confidence load (tri-spec relies on knowing when the currency is soft).

### 1.5 Why this is summable — and already half-built

`server/insights.ts` **already sums `trainingLoad` across all sports with no sport filter** onto one CTL curve (`loads = rows.map(... trainingLoad ...)`, all sports, → `computeFitnessFatigue`). So a single cross-sport curve is *already the production behavior* — it's just being fed incommensurable units today. This spec makes that existing sum **correct** rather than introducing a new summation. `server/fitness.ts` does the same for the live PMC. No PMC-shape change is required (tri-spec §"engine mapping" confirms: "No change *provided* §7.4 lands").

---

## 2. Migration of the existing model

### 2.1 What changes and what doesn't

- **Changes:** the *values* in `activities.trainingLoad`, and the `form` thresholds in `server/fitness.ts` (`tsb > 5 'fresh'`, `tsb < −10 'fatigued'`).
- **Unchanged:** `computeFitnessFatigue` (τ's, EWMA, TSB=CTL−ATL), the `fitness_fatigue_states` shape, all chart plumbing, `insights.ts` peak-CTL logic (it recomputes from `trainingLoad`, so it inherits the new currency for free).
- **Consequence:** every existing user's live fitness chart keeps its **shape** but is **renumbered** onto the TSS axis (§2.3). This is a visible change to a number athletes/coaches watch — hence the sign-off gate (§2.4).

### 2.2 Backfill procedure (historical recompute)

1. **Add columns (non-destructive):** `activities.trainingLoadTss` (double) + `activities.loadConfidence` (`power|pace|css|hr|estimated`). Keep the legacy `trainingLoad` (TRIMP) column intact during transition so we can diff and roll back.
2. **Per-athlete anchors:** resolve historical FTP / threshold pace / CSS / LTHR. Where an anchor was never set, fall back down the ladder (hrTSS → estimatedTss). Anchors drift over time; v1 uses the *current* anchor for all history (acceptable — the PMC is relative, and re-anchoring history is a later refinement). Document this as a known approximation.
3. **Recompute** each activity's load via the new `estimateLoad` into `trainingLoadTss`.
4. **Recompute** `fitness_fatigue_states` from `trainingLoadTss` (same `computeFitnessFatigue` call, warmed over full history as today).
5. **Diff report** (offline, no writes to prod): for each athlete, old vs new CTL/ATL/TSB percentiles + the current TSB delta, so we can *see* the renumber magnitude before flipping the read path (§2.3, §2.4).
6. **Cutover** = point `fitness.ts` / `insights.ts` reads at `trainingLoadTss`. This is a **one-line source swap behind the flag**, reversible instantly.

### 2.3 Quantifying the magnitude shift (so we can pick thresholds)

The scales differ, so **thresholds must move**. Anchor the conversion on the identity that **1 h at threshold = 100 TSS** vs. **1 h at threshold-HR TRIMP**:

- **Banister TRIMP for 1 h at threshold-HR:** at threshold, HRr ≈ 0.85–0.90. Men: `60 × 0.87 × 0.64 × e^(1.92×0.87) ≈ 60 × 0.87 × 0.64 × 5.31 ≈ 177`. So **1 threshold-hour ≈ ~150–180 TRIMP** but **= 100 TSS**. → **TSS ≈ 0.55–0.65 × TRIMP** for threshold-ish work.
- **Easy/aerobic work compresses harder:** TRIMP is near-linear in HRr at low intensity while TSS is quadratic in IF, so easy hours that scored, say, ~50 TRIMP map to ~30–42 TSS. Net: **CTL/ATL fall to roughly 0.55–0.7× their old numeric value**, intensity-mix dependent.
- **The HR-free volume fallback barely moves:** old `durMin × 0.7` = 42/h; new endurance `estimatedTss` (IF 0.65) = `0.65²×100` ≈ 42/h. Near-identical by construction — deliberately chosen so HR-free athletes see almost no renumber.

**Because CTL and ATL both scale by ~the same factor k≈0.6, TSB = CTL − ATL also scales by ~k.** So the `form` thresholds should scale by the same factor:

| Threshold | Today (TRIMP-TSB) | New (TSS-TSB), scaled ×~0.6 | Cross-check vs. TSS convention |
|---|---|---|---|
| `fresh` (TSB >) | `> 5` | **`> +5`** (round; already near TSS norms) | TrainingPeaks "fresh/transition" ≈ +5…+25 |
| `fatigued` (TSB <) | `< −10` | **`< −10`** | TrainingPeaks "high fatigue / overreaching" ≈ −10…−30 |

**Convenient result:** the *existing* thresholds (+5 / −10) already sit in the range TrainingPeaks uses for **TSS-based** TSB (the "training stress balance" bands the community knows: >+25 very fresh, +5…−10 neutral/grey zone, −10…−30 optimal training, <−30 overreaching). So after the renumber, the current numbers are close to *more* defensible, not less — but we must **verify against the §2.2 diff report per real athlete**, because CTL magnitude (and thus the TSB spread) depends on training volume. **Do not hard-code new thresholds until the diff report confirms the per-athlete TSB distribution.** Provisional plan: keep +5 / −10, widen to a 3-band with a `veryFatigued < −25` for the overreaching guardrail the tri-allocator needs (tri-spec §7.2 "TSB floor").

### 2.4 Rollout & sign-off (this changes live charts)

This renumbers a number athletes and coaches actively watch, so:

1. **Flag-gated** (`engineSettings` flag `loadCurrency: 'trimp' | 'tss'`, default `'trimp'`). Backfill writes the parallel column; reads only switch when the flag flips.
2. **Owner sign-off required to flip** — matches the pattern for the cycling PMC decision and admin-gated settings (per the admin-settings-ui-backlog memory: engine-affecting settings are owner-controlled, currently env/flag, later an admin UI). The flip is a single global action with a visible diff.
3. **What athletes/coaches see on flip:** the fitness chart keeps its **shape** (peaks, ramps, taper dips all in the same places) but the **y-axis renumbers** — CTL/ATL land ~40% lower in absolute value; TSB compresses proportionally. **Communicate proactively:** a one-time coach-facing note ("we moved fitness onto the standard TSS scale — 100 = one hour at threshold; your chart's shape is unchanged, the numbers now match TrainingPeaks conventions"). The `form` label ('fresh'/'neutral'/'fatigued') should read *the same* on flip day for most athletes because thresholds scaled with the data — that's the acceptance test: **label stability across the cutover for the roster** (spot any athlete whose label flips and confirm it's correct, not an artifact).
4. **Reversible:** flip back to `'trimp'` reads instantly; parallel columns retained until we're confident.
5. **Do not touch prod DB during design/spike** — the diff report runs against a snapshot/replica, never `DATABASE_URL`.

---

## 3. Cross-sport transfer model

### 3.1 The physiological split

A single summed PMC (§1) treats an hour of bike and an hour of run as *interchangeable systemic stress*. That's **correct for the central aerobic system and wrong for everything peripheral.** The literature is consistent that endurance fitness has (at least) two separable buckets:

- **Central / transferable** — cardiac output (stroke volume, plasma volume, max HR-independent Q̇), and the *general* mitochondrial/oxidative machinery. These are trained by systemic aerobic stress regardless of modality and **transfer across sports**. (Clausen 1977, *Physiol Rev*, central vs. peripheral circulatory adaptation; Bassett & Howley 2000, *MSSE*, VO₂max limited primarily by central cardiac output.)
- **Peripheral / sport-specific** — the *recruited-muscle* adaptations: capillary density and mitochondrial content **in the specific muscles/fiber-recruitment pattern used**, plus **neuromuscular economy** (efficiency of the movement) and **musculoskeletal durability / impact tolerance** (tendon, bone, connective-tissue and eccentric-contraction resilience). These are **largely non-transferable** — trained only by doing the sport. (Saltin et al. 1976, one-leg training: adaptations are local to the trained limb; Rud/Holloszy: mitochondrial adaptations are muscle-specific.)

**Cross-training studies** confirm the asymmetry: cycling maintains/imparts substantial *central* aerobic benefit to runners, but does **not** confer running's economy or the eccentric-loading durability of the run — and running's musculoskeletal stress (~2–3× bodyweight impact per stride) has **no** low-impact equivalent. (Foster et al.; Millet, Vleck & Bentley 2009 review of run–bike transfer in triathletes; Tanaka 1994 review of cross-training — cross-training preserves VO₂max but sport-specific performance needs sport-specific work.)

### 3.2 Transfer coefficients (proposed, tunable global→athlete like `GlobalPaceModel`)

Each ordered pair (source sport → target sport) gets coefficients for **central**, **economy**, and **durability** transfer. Central transfer is high and roughly symmetric; economy and durability are near-zero across modalities.

| Source → Target | Central-aerobic | Economy (skill/efficiency) | Durability / impact tolerance | Notes & basis |
|---|---|---|---|---|
| **Bike → Run** | **0.70–0.90** | ~0.10 | **~0.00** | Big engine transfers; no eccentric/impact loading. Millet et al. 2009. |
| **Run → Bike** | **0.70–0.85** | ~0.10 | n/a (bike low-impact) | Runners carry aerobic base to bike; lack pedaling economy. |
| **Pool-run → Run** | **0.80–0.90** | **0.40–0.60** | **0.10–0.25** | Same gait pattern, no ground impact → high specificity, partial durability. Classic injury-rehab modality (Wilber et al. 1996, deep-water running maintains VO₂max in runners). |
| **Elliptical → Run** | 0.70–0.85 | 0.25–0.40 | ~0.05–0.15 | Weight-bearing-ish, run-like leg cycle, minimal impact. |
| **Swim → Run/Bike** | **0.30–0.50** | ~0.00 | ~0.00 | Upper-body-dominant, horizontal, non-weight-bearing; smallest leg-muscle overlap → lowest central transfer per hour. Millet et al. |
| **Bike ↔ Bike / Run ↔ Run (same sport)** | 1.00 | 1.00 | 1.00 | Full credit — the trivial identity row. |

These are **starting values with citations, explicitly tunable** — layered config exactly like `GlobalPaceModel` / `GlobalPowerModel` (global default → athlete override), and improvable from the override-log / goal-tracker data over time.

### 3.3 How the PMC represents this

Replace "one CTL" with **one central curve + N specific tracks**, all using the same `computeFitnessFatigue` kernel:

- **Central-aerobic CTL/ATL/TSB** = `computeFitnessFatigue( Σ_sports load_s )` — i.e. **exactly today's summed PMC** (§1.5). Every sport feeds it at **full** load (central transfer of same-sport is 1.0, and the cross terms are captured by the *specific* tracks, not by discounting the central sum). This is the athlete's true **systemic fitness/fatigue/form** and what the tri-allocator's TSB guardrail reads.
- **Per-discipline specific CTL** `CTL_specific[d] = computeFitnessFatigue( Σ_s transfer_central[s→d] × load_s )` — a run-specific curve credits run load fully, bike load ~0.8, swim ~0.4, pool-run ~0.85. This is the "how much of my fitness is *expressed in running*" curve.
- **Per-discipline durability track** `durability[d] = computeFitnessFatigue( Σ_s transfer_durability[s→d] × load_s )` — for the **run** target this is essentially *run-only* load (bike/swim contribute ~0), with pool-run/elliptical contributing a little. Slower time constant is appropriate (bone/tendon adapt over weeks-to-months; consider τ ≈ 42–90 d for durability vs. 42 d for CTL). This is the curve that says "your legs can *absorb* running," independent of your engine.

Storage: extend `fitness_fatigue_states` with a `track` discriminator (`central | specific:<sport> | durability:<sport>`) or a sibling table; the read models (`fitness.ts`, `insights.ts`) select the track they need. Backward-compatible: `central` == today's single curve.

### 3.4 How readiness & feasibility consult central vs. specific

The whole point: **a big bike engine must not overstate run readiness or run durability.**

- **Aerobic-capacity questions** (can the athlete *metabolically* sustain the effort? projected event-day CTL vs. event TSS demand — cycling-spec §3 fondo feasibility, tri-spec §7.2 TSB floor) → read **central CTL/TSB**. Bike hours legitimately raise this.
- **Sport-specific performance questions** (can they hold *goal run pace* off the bike, VDOT-style projection) → read the **run-specific CTL**. A cyclist-turned-runner with huge central fitness but low run-specific fitness gets an honest, discounted run projection.
- **Durability / injury-risk / feasibility of a run prescription** (is this long run / this weekly run mileage safe?) → read **run durability**, **never** central. This is the guardrail that stops the engine from prescribing 40 mi/week to someone whose central engine says "easy" but whose legs have run 10 mi/week. Wire this into `engine/plan/feasibility.ts` and `guardrails.ts`: the run-volume ramp is capped by run-durability, not by central CTL.
- **The readiness engine (`engine/readiness.ts`)** stays central-driven for daily HRV/sleep/RPE (systemic recovery), but the **feasibility/guardrail layer** gains the specific/durability read. Concretely: `readiness` answers "how hard *today*"; `feasibility` answers "is this *specific* prescription safe given specific fitness + durability." Keeping them separate preserves the current readiness behavior while adding the cross-sport honesty exactly where prescriptions are sized.

---

## 4. Impact-substitution as a first-class preference

### 4.1 The setting

A standing athlete/coach preference (not only injury-triggered) to **cap run impact and substitute low-impact aerobic** — for masters athletes, injury-prone runners, or high-volume athletes deliberately managing musculoskeletal load. Model it as an `athleteNotes`-style structured preference or a first-class column, consumed by the engine at plan time:

```
impactPolicy: {
  maxRunSharePct?: number      // cap running as % of weekly load (e.g. 60)
  maxRunDaysPerWeek?: number
  maxWeeklyRunKm?: number
  substituteModalities: string[]  // preference order, e.g. ['pool_run','bike','elliptical']
  raceRunRampWeeks?: number    // mandatory run-specific ramp before race (default 8–10)
}
```

This **reuses `injuryRecords.allowedModalities`** (`['bike','swim','pool_run']`) as the *involuntary* form of the same mechanism — the difference is only the trigger (chosen preference vs. injury directive). Both resolve to the same substitution rules below.

### 4.2 Substitution rules (equivalent aerobic load via the unified currency)

When a run session is capped/removed, replace it with **equal central-aerobic load** in the preferred low-impact modality — this is *only expressible because §1 gave us a common currency*:

1. Take the run session's **planned TSS** (`targetLoad`, §1.3e).
2. Emit a substitute session in the top-ranked `substituteModalities` sport with the **same TSS target**, converted to that sport's duration via its zone/IF: `duration = TSS / (IF² × 100) × 3600`. Central-aerobic stimulus is preserved (transfer_central ≈ 0.7–0.9 for bike, ~0.85 pool-run).
3. **Honor pool access** (tri-spec §1.3 `swimAccess` / long-session windows) — don't substitute a pool-run onto a day with no historical pool access unless overridden.
4. Prefer **pool-run / elliptical** when the goal is run-specificity retention (they carry economy + partial durability, §3.2); prefer **bike** when the goal is pure aerobic volume with lowest recovery cost (tri-spec §3.3: bike has the lowest injury/recovery cost per hour).

### 4.3 Honest durability-tradeoff flagging

Substitution **preserves central fitness but not run durability** (§3.1). The engine must say so, not hide it:

- Every substituted block **debits run durability** (bike credits ~0, pool-run ~0.1–0.25) even as it credits central CTL fully. The **run-durability track visibly lags** the central curve.
- Surface a standing, honest flag: *"Low-impact substitution is protecting your legs and holding your engine, but run-specific durability is building slower — you'll need N weeks of real run volume before race day to be race-ready on your feet."* This is the anti-pattern guard against a naive optimizer that would happily replace all running with bike (great for central CTL and TSB, catastrophic for a running race — mirrors tri-spec §5.2's "floors encode the coaching the raw economics miss").
- The feasibility layer (§3.4) reads run-durability, so it will **refuse** to certify a goal-race run prescription that durability can't support, regardless of how good central fitness looks.

### 4.4 Run-specific-volume ramp before race day

Reuse the **adaptation/monitor loop** (`server/monitor.ts`, `adaptation.ts`, windowed directives). A `raceRunRampWeeks` window before the goal race:

- Progressively **re-introduces impact run volume** (a `reduce_volume`-style directive run *in reverse* — a scheduled ramp-up of the run share), lifting the `maxRunSharePct` cap week by week so run-durability closes the gap to what the race demands.
- The ramp is **capped by the durability track's safe rate** (the same ramp guardrail as injury ease-back / `decideRecoveryEase`), so it's aggressive enough to be race-ready but bounded to avoid the classic "too much run, too late" injury.
- If durability can't reach race demand within the window, the engine flags it early (goal-tracker style, tri-spec) rather than at race week.

This slots into the existing directive machinery with **no new control plane** — it's a new *category* of windowed directive (`impact_substitution`, `run_ramp`) alongside `injury`, `low_recovery`, `missed_days`, cleared/rewritten idempotently by the daily monitor.

---

## 5. The two use cases, concretely

### 5.1 Runner who cross-trains on the bike → full aerobic credit, discounted run-durability credit

A marathoner adds two 90-min Z2 rides/week for extra aerobic volume without extra pounding.

- **Currency:** each ride → TSS via power (or hrTSS). Say 90 min @ IF 0.68 → `0.68²×1.5×100 ≈ 69` TSS/ride.
- **Central PMC:** both rides feed the **central CTL at full 69 each** — their central engine rises exactly as if they'd done equivalent aerobic work. Their fitness chart (central) climbs; TSB reflects the real systemic load (so the engine won't stack a hard run on a day two big rides already fatigued them).
- **Run-specific CTL:** rides credit run-specific at ~0.8 → ~55 each; run-durability at ~0 → the **durability track does not move** from the rides. So the marathon *pace* projection improves modestly (central + partial specific), but the **legs-can-take-the-miles** read comes almost entirely from actual running.
- **Feasibility:** the engine will *not* let the bike volume justify a bigger long run — long-run size stays governed by run-durability. Honest and injury-safe. Correct coaching outcome: "great aerobic work, keep your run progression where your legs are."

### 5.2 Deliberate low-impact substitution for an injury-prone / masters / high-volume athlete

A 50-year-old with recurrent Achilles issues sets `impactPolicy { maxRunSharePct: 55, substituteModalities: ['pool_run','bike'], raceRunRampWeeks: 10 }`, targeting a half-marathon.

- **Weekly plan:** engine caps running at 55% of weekly TSS; the remaining aerobic target is filled with pool-runs (economy + partial durability) and bike (volume, lowest recovery cost), each sized to **equal TSS** via §4.2.
- **Central fitness:** stays high — the substitution preserves systemic aerobic load, so central CTL and race-TSS feasibility look strong.
- **Durability, honestly flagged:** run-durability builds slower; the standing flag (§4.3) tells athlete+coach the tradeoff continuously.
- **Race ramp:** the 10-week `run_ramp` window progressively lifts the run cap so run-durability closes toward half-marathon demand, bounded by the safe ramp rate. If Achilles flares, `reportInjury` / `allowedModalities` overlay the *involuntary* substitution using the **same machinery**, and the monitor eases the ramp — seamless because voluntary and injury substitution share the mechanism.
- **Outcome:** the athlete trains a lot of safe aerobic volume, arrives race-ready on their feet, and is never misled that a bike-fueled engine means their Achilles can handle race mileage.

---

## 6. Engine mapping + sequenced build plan

### 6.1 Touch map

| Concern | File(s) | Change |
|---|---|---|
| Unified load kernel | `engine/load.ts` | Add `tssFromPower`, `rTSS` (NGP/GAP), `sTSS` (CSS), `hrTSS` rescale, `estimatedTss`; sport-switch dispatch in `estimateLoad`; return existing `LoadResult` + confidence tier. |
| Swim anchor glue | `db/swimConfig.ts` (new, mirrors `paceConfig.ts`/`powerConfig.ts`), `engine/plan/*` swim zones | CSS anchor + per-100 bands (tri-spec T2). |
| Run NGP/GAP | `engine/plan/gap.ts` (exists), new NGP helper | Grade-adjust + variability-weight for rTSS. |
| PMC kernel | `engine/fitnessFatigue.ts` | **Unchanged.** Optionally add durability τ variant. |
| Multi-track PMC | `fitness_fatigue_states` (schema), `server/fitness.ts`, `server/insights.ts` | `track` discriminator; central == today's curve; specific + durability tracks via transfer coefficients. |
| Transfer config | new `transferModel` in `engineSettings` (global→athlete, like `powerModel`) | Coefficients from §3.2, tunable. |
| Form thresholds | `server/fitness.ts` | Recalibrate per §2.3 after diff report; add `veryFatigued` band. |
| Backfill + flag | migration/backfill script (offline, replica), `engineSettings.loadCurrency` flag | Parallel `trainingLoadTss` + `loadConfidence` columns; reversible cutover (§2.4). |
| Impact policy | new `impactPolicy` (athlete-level), reuse `injuryRecords.allowedModalities` | §4 setting + substitution resolver. |
| Substitution + ramp | `server/monitor.ts`, `server/adaptation.ts`, `server/directives.ts` | New directive categories `impact_substitution`, `run_ramp`; TSS-equal substitution; durability-bounded ramp. |
| Feasibility/guardrails | `engine/plan/feasibility.ts`, `guardrails.ts` | Consult specific/durability tracks for run-volume sizing (§3.4). |

### 6.2 Build sequence (stories, estimates, dependencies)

| # | Story | Depends on | Est. | Notes |
|---|---|---|---|---|
| **L0** | **Unified `estimateLoad` ladder** — TSS(power)/rTSS/sTSS/hrTSS/estimatedTss, one output shape + confidence tier. Pure engine, fully unit-testable against known TSS calculators. | cycling power (landed), pace/CSS anchors | 3–4 d | The kernel. Cycling-spec Story 3 ≈ this; **includes the running-side rTSS change** it flagged. |
| **L1** | **Backfill + diff report** (offline, replica only) — parallel `trainingLoadTss`/`loadConfidence`, recompute PMC, per-athlete old-vs-new CTL/TSB diff. | L0 | 2–3 d | Produces the numbers to set thresholds. **No prod writes.** |
| **L2** | **Threshold recalibration + flag cutover** — pick thresholds from L1, `loadCurrency` flag, reversible read swap, coach-facing note. **Owner sign-off gate.** | L1 | 1–2 d | The visible flip. |
| **L3** | **Transfer model + multi-track PMC** — coefficients config, central + specific + durability tracks, `fitness_fatigue_states.track`. | L0 (currency valid) | 3–4 d | Enables honest cross-sport readiness. |
| **L4** | **Feasibility consults specific/durability** — run-volume sizing governed by run-durability not central. | L3 | 2 d | The "big engine ≠ durable legs" guard. |
| **L5** | **Impact-substitution preference + ramp** — `impactPolicy`, TSS-equal substitution, durability-bounded race ramp, honest flagging; reuse `allowedModalities` + monitor loop. | L0, L3, L4 | 3–4 d | Delivers both §5 use cases. |

**Total ≈ 14–19 d.** L0–L2 are the strict **T0 gate**: they are the "unified currency (Option A) confirmed" milestone that both prior specs make a hard prerequisite. L3–L5 add the transfer/substitution intelligence and can follow in parallel with early cycling-periodization and tri-allocator work.

### 6.3 Why this is the gate

- **Cycling periodization** (cycling-spec Stories 3+) periodizes on **weekly TSS** and shares the PMC — it is *arithmetically undefined* until running and cycling speak one currency (L0) and the PMC is renumbered onto it (L2).
- **Triathlon allocator** (tri-spec T4) sums swim+bike+run into **one `weeklyTargetLoad`** and reasons on **one PMC** — tri-spec §7.4 states plainly it "cannot be correct until that decision lands, and it must land on the TSS-equivalent side." L0 lands exactly that; L3 adds the central-vs-specific split the allocator's return-on-time and durability terms need.
- Until L0–L2 ship, both engines can only run in **degraded per-discipline mode** (separate budgets, no cross-sport trade-off) — which defeats the entire purpose of both projects.

---

## 7. Sources

- **Allen, Coggan & McGregor** — *Training and Racing with a Power Meter*, 3rd ed. (2019). TSS, NP, IF definitions; TSS = IF²×hours×100; NP = 4th-power 30 s rolling. TrainingPeaks TSS/NP/IF documentation (productized forms).
- **Daniels, J.** — *Daniels' Running Formula*, 3rd ed. VDOT, threshold ("T") pace.
- **Minetti et al. (2002)**, *J Appl Physiol* — energy cost of running vs. gradient (basis for GAP). Strava GAP as the productized form. TrainingPeaks **NGP / rTSS** methodology.
- **Wakayoshi et al. (1992)**, *Eur J Appl Physiol* — Critical Swimming Speed as a lactate-threshold surrogate (basis for CSS → sTSS). Swim Smooth / TrainingPeaks CSS productization.
- **Banister, E.W.** — impulse-response TRIMP model (existing `load.ts`); the HR-reserve exponential weighting.
- **Clausen (1977)**, *Physiol Rev* — central (cardiovascular) vs. peripheral (muscular) adaptation. **Bassett & Howley (2000)**, *MSSE* — VO₂max limited primarily by central cardiac output. **Saltin et al. (1976)** — one-leg training, local/peripheral specificity of adaptation.
- **Millet, Vleck & Bentley (2009)** — review of run/bike physiological interactions & transfer in triathletes. **Tanaka (1994)** — cross-training effects on endurance performance (VO₂max preserved, sport-specific performance needs specific work). **Wilber et al. (1996)** — deep-water (pool) running maintains VO₂max in trained runners (basis for high pool-run central + partial durability transfer).
- **Friel, J.** — *The Triathlete's Training Bible* — limiters, event-specificity, training-stress-balance banding conventions (referenced via tri-spec).
- **Internal:** `cycling-engine-spec.md` §4.1–4.4; `triathlon-time-optimization-spec.md` §2.3, §3.3–3.4, §5, §7.4, story T0. Codebase: `engine/load.ts`, `engine/fitnessFatigue.ts`, `server/fitness.ts`, `server/insights.ts`, `db/powerConfig.ts`, `db/paceConfig.ts`, `server/injury.ts`, `server/monitor.ts`, `server/adaptation.ts`, `db/schema.ts` (`activities.trainingLoad`, `injuryRecords.allowedModalities`, `sportEnum`).

*Coefficients, thresholds, and transfer values in this doc are defensible starting points with citations, intended to be tuned via the same global→athlete config layering used for `GlobalPaceModel` / `GlobalPowerModel`, and improved from the override-log and goal-tracker data over time. This is a design document only — no code, schema, or production data was modified.*
