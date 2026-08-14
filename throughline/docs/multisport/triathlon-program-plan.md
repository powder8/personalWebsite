# Triathlon Program Plan — from today to a usable service for the June-2027 cohort

**Status:** build program, design only, no code. **Date:** 2026-08-14.
**Target race:** a real triathlon in **June 2027** that Peter + a handful of friends will train for as the **guinea-pig cohort** — the first real users on the path to public release.
**Companion docs:** `swim-foundation-spec.md` (this batch); `docs/multisport/{cycling-engine-spec,triathlon-time-optimization-spec,load-currency-transfer-spec}.md`.

---

## 1. The usable milestone (what "done enough" means)

> **M — "A real multi-sport plan Peter + friends can train against."**
> Each cohort athlete has a CSS, an FTP, and a run threshold on file; the engine produces **one weekly plan spanning swim + bike + run** that respects their **actual available hours**, targets the June-2027 race, prices every session in the **one shared TSS-equivalent currency**, rolls all three sports onto **one PMC**, and **adapts week-to-week** through the existing monitor loop. They open the app, see this week's swim/bike/run sessions with paces/power/CSS targets, train, and the plan responds.

That is the guinea-pig milestone. It is *not* the full tri spec (no cohort-percentile limiter analysis, no optimization solver, no inferred-from-history time budget required) — it is the **thin usable slice** of it. Everything past M is refinement the cohort's own data will inform.

### The real deadline is not June — it's ~January 2027

A June-2027 race with a proper base→build→peak wants a **~20–24 week** structured build, i.e. training starting **~Dec 2026–Jan 2027**. So **M must ship by ~end of 2026** (≈4.5 months from today) for the cohort to actually train *on the plan* rather than retrofit it. Anything landing after ~March 2027 only supports a rushed peak. This reframes the whole program: **the engineering deadline is Q4-2026 → Jan-2027, not June.**

---

## 2. Where we are today (shipped inventory)

The foundational, cross-cutting work is **already done** — which is what makes M reachable in months, not quarters:

| Capability | State | Evidence |
|---|---|---|
| `discipline` dimension + `DisciplineStrategy` seam | shipped | `engine/plan/strategy.ts` (`selectStrategy` handles run/bike) |
| Running engine | shipped (the reference) | `runStrategy` + `workouts`/`generate`/`periodize`/`feasibility` |
| Cycling FTP anchor + power/HR zones | shipped | `ftpLogic.ts`, `powerZonesLogic.ts`, `bikeStrategy` (anchor+zones done) |
| **Unified TSS-equivalent load currency — now the DEFAULT** | shipped & live | `loadCurrencyLogic.ts` (all rungs), `loadCurrencyFlagLogic.ts` |
| Cross-sport transfer model / multi-track PMC | shipped | `transferLogic.ts`, `server/fitnessTracks.ts` |
| Proactive adaptation loop | shipped | `server/monitor.ts`, `adaptation.ts` |

The **hard T0 gate** both prior specs called out — "unified currency confirmed, one PMC valid across sports" — **has landed** (currency is the default; transfer/tracks shipped). That gate blocked *everything*; it's behind us. What remains is per-discipline completion and the tri assembly on top.

### What's missing (the three gaps between here and M)

1. **Cycling is half-built.** `bikeStrategy` has anchor + zones but `buildQualitySegments`/`buildQualityDescription`/`assessGoalFeasibility` are **throwing stubs** (`bikeStrategy.ts`), the workout library is run-only (`workouts.ts`), and there is no cycling `generateWeek` or UI. Cycling spec Stories **4–7 are open**.
2. **Swim doesn't exist.** No `swimConfig`, no CSS source, no `swimStrategy`. The `stss()` rung and `cssMetersPerSec` anchor field exist but nothing populates them, so swim load silently falls to `estimated`. See `swim-foundation-spec.md`. This is the **biggest single chunk.**
3. **No tri assembly.** No time budget, no allocator, no multi-discipline plan/week, no `triStrategy`. Tri spec **T1/T4/T5/T8** are open (T2 = swim, covered by gap 2).

---

## 3. Critical path

```
Finish CYCLING            Build SWIM               TRI assembly
(workouts→generate→UI)    (CSS→zones→lib→seam)     (budget→allocator→multi-sport week)
        │                        │                          │
        └───────────┬───────────┘                          │
                    ▼                                       ▼
        two complete disciplines  ───────────────►  M: one multi-sport plan,
        + swim on the currency                       one PMC, adapting
```

Cycling-finish and swim-build are **independent and parallelizable** (different files, both sit on the already-shipped currency/seam). The tri allocator needs **both** disciplines complete *and* the currency (have it), because it sums swim+bike+run into one `weeklyTargetLoad` on one PMC (tri spec §7.4). So: **finish the two legs in parallel, then assemble.**

---

## 4. Story-by-story sequence

Estimates are ideal-dev-days, reconciled with the existing spec build plans (cycling §7, tri §8.3, load §6.2). **Reality check:** this is a nights-and-weekends project for a CTO; assume **~1.5–2 effective dev-days/week**. The MVP column below is what actually fits before Jan-2027; the rest is post-race.

### Phase A — Finish cycling (parallelizable with Phase B)

| # | Story | Deliverable | Depends on | Est. | In MVP? |
|---|---|---|---|---|---|
| C4 | Cycling workout library | `BikeSegment`/`BikeQualityTemplate` (endurance→sprint), seed rotation, embedded-work endurance rides, prose | zones (done) | 3–4 d | ✅ |
| C5 | Cycling generate + periodize | `generateWeek` distributes weekly TSS → per-day duration@power; plug into shared `periodize.ts` | C4 | 3 d | ✅ |
| C6 | Cycling events + feasibility | `assessGoalFeasibility` FTP/CTL model; unstub | C5 | 3–4 d | ⚠️ trim¹ |
| C7 | `bikeStrategy` assembly + UI | unstub `buildQuality*`, register behind dispatch, run through `adapt.ts`, **cycling session UI** | C4–C6 | 3 d | ✅ |

¹ C6 feasibility can ship a **coarse** verdict for MVP (is the race reachable at current CTL trend?) and defer precise FTP-gain modeling post-race.

### Phase B — Build swim (parallelizable with Phase A) — see `swim-foundation-spec.md`

| # | Story | Deliverable | Depends on | Est. | In MVP? |
|---|---|---|---|---|---|
| S0 | `Discipline` += `'swim'` | union in `types.ts`, `selectStrategy` case | — | 0.5 d | ✅ |
| S1 | CSS anchor + `swimConfig` | `cssLogic.ts` (`resolveCss`, `cssFrom*`), `athletes.swimConfig` + `engine_settings.swimModel`, `db/swimConfig.ts` glue | S0 | 3 d | ✅ |
| S2 | Swim zones from CSS | `swimZonesLogic.ts`, per-CSS pace bands, `strengthBias`, `SwimZones` in `TrainingZones` | S1 | 2 d | ✅ |
| S3 | Activate sTSS | wire `getAthleteCss` → `anchors.cssMetersPerSec` at swim load call site (no new load code) | S1 | 0.5 d | ✅ |
| S4 | Swim workout library | CSS-relative sets + technique/drill category + prose | S2 | 3–4 d | ✅ |
| S5 | `swimStrategy` assembly | full `DisciplineStrategy`, register, run through adapt loop | S1–S4 | 2 d | ✅ |
| S6 | Manual/no-watch + OW handling | manual distance/time/RPE entry; open-water CSS offset | S3 | 2 d | ⚠️ partial² |

² MVP needs *manual entry* (cohort will swim without watches); the open-water offset can be a single tunable constant v1, refined post-race.

### Phase C — Tri assembly (needs A + B complete)

| # | Story | Deliverable | Depends on | Est. | In MVP? |
|---|---|---|---|---|---|
| T1 | Time budget | `timeBudget.ts`: realistic weekly hours + day constraints; **MVP = manual entry**, inference post-race | currency (done) | 2 d (MVP) / 3–4 d (full) | ✅ manual |
| T4 | Allocator (heuristic) | budget + race-demand + floors → per-discipline `weeklyTargetLoad` + intensity split + day layout | T1, A, B | 4–6 d | ✅ core |
| T5 | Multi-sport plan + bricks | multi-discipline `PlannedDay` (ordered segments/bricks), plan grouping, merge per-discipline generate into one week | T4, C5, S4 | 4–5 d | ✅ |
| T8 | `triStrategy` orchestration + UI | assemble budget→allocator→per-sport generate→merged week→adapt overlay; **multi-sport week UI** | T1–T5 | 3–4 d | ✅ |
| T3 | Limiter analysis | cohort-percentile weakest-link + priority vector | S-anchor | 3 d | ❌ post-race³ |
| T6 | Composite feasibility | three-discipline race-time projection | T4 | 2–3 d | ❌ post-race |
| T7 | Re-allocation in monitor | auto re-solve on time shortfall/surplus | T4, monitor | 3 d | ❌ post-race |

³ For MVP the allocator biases by a **simple self-reported limiter** ("swim is my weakness") + race-demand weights + floors — good enough for a known cohort. Cohort-percentile limiter analysis (T3) needs a reference table and is exactly the thing the cohort's data will *build*, so it's naturally post-race.

### The M critical path (what has to land, in order)

```
S0 → S1 → S2 → S3 ─┐               (swim leg)
C4 → C5 → C7 ──────┤→ T1(manual) → T4 → T5 → T8 = M
S4 → S5 ───────────┘               (both legs feed the allocator)
```

**MVP dev-day total ≈ 34–42 d** of focused work. At ~1.75 d/week that is ~5–6 months of calendar — which is why M must be scoped hard and started now to make the Jan-2027 training start. Phase A and B running in parallel (they touch disjoint files) is what makes it fit.

---

## 5. Guinea-pig → public-release gates

### Gate G1 — "usable by the cohort" (= milestone M, ~Dec 2026)
- [ ] Each cohort athlete has CSS + FTP + run-threshold on file (onboarding flow surfaces the CSS 400/200 test and FTP test as required setup).
- [ ] Engine emits one multi-sport week (swim+bike+run) targeting the June race, on one PMC, in one currency.
- [ ] Every session shows real per-athlete targets (CSS pace / watts / run pace), not placeholders.
- [ ] Adaptation loop runs end-to-end on a multi-sport plan (readiness ease-off, ramp guardrail, over/under-delivery) without discipline-specific crashes.
- [ ] Manual/no-watch swim logging works (cohort *will* swim without devices).

### Gate G2 — "trustworthy for the cohort" (Jan–June 2027, in-flight)
- [ ] Swim load is `css`-confidence (not `estimated`) for anyone who's tested — verified on real cohort activities.
- [ ] The multi-track PMC produces sane cross-sport readiness (no bike engine justifying unearned run volume — the durability guard, `transferLogic.ts` `runVolumeSafety`).
- [ ] Allocator output is coach-sane on all cohort athletes (a real coach / Peter eyeballs a full block per person).
- [ ] Tune the flagged coefficients against real data: `swim→run` central (0.60, `transferLogic.ts:114`), CSS zone offsets, return-on-time table.
- [ ] The cohort actually completes the race — the ultimate validation signal.

### Gate G3 — "open to the public" (post-race, gated on G2 evidence)
- [ ] Cold-start works for a stranger: sensible defaults + guided testing when there's no history (the cohort all had running history; the public won't).
- [ ] Limiter analysis (T3) shipped with a real reference-cohort percentile table — *built from* the guinea-pig + post-race data.
- [ ] Time-budget **inference** from history (full T1), not just manual entry.
- [ ] Composite feasibility (T6) + re-allocation (T7) so the plan self-corrects for users without a coach watching.
- [ ] Robustness: unit handling (yd/m), pool/open-water, missing-data paths, multiple concurrent athletes, race-distance coverage (sprint/Olympic/70.3).
- [ ] Onboarding a swim/bike/run athlete from zero is self-serve — no Peter in the loop.

**The gating principle:** the cohort proves the *engine is correct* (G1→G2); public release requires the engine also be *self-serve and robust for people with no history and no coach* (G3). Don't conflate them — M is a correctness milestone, not a productization one.

---

## 6. How M reuses what's already shipped

M is cheap precisely because the hard cross-cutting infrastructure is done — the new work is per-discipline content + assembly, all sitting on shipped foundations:

- **The TSS-equivalent currency** (`loadCurrencyLogic.ts`) is the lingua franca that makes the allocator *possible*: swim sTSS, bike TSS, and run rTSS are the same `IF²·h·100` number (`loadFromIntensity`, `:104`), so T4 can sum them into one `weeklyTargetLoad` and split it back per discipline. **Swim's activation (S3) is one wire** — `getAthleteCss` → `anchors.cssMetersPerSec` — because the rung and dispatch already exist (`:225`, `:393`). No load math is written for the tri; it's all reuse.
- **The transfer model / multi-track PMC** (`transferLogic.ts`, `fitnessTracks.ts`) already knows swim↔bike↔run: the swim target row and swim source terms are in `TRANSFER_TABLE`, so the moment swim emits real load, cross-sport readiness and the central/specific/durability split the allocator's return-on-time and run-volume-safety terms need are *there*, computed by `computeFitnessTracks`. The tri assembly consults it; it doesn't build it.
- **The adaptation loop** (`monitor.ts`, `adaptation.ts`) is discipline-agnostic — it acts on the PMC/TSB signal and readiness bands, which are now multi-sport. A multi-sport plan flows through the same ease-off / ramp-guardrail / directive machinery with no new adaptation logic; tri spec T7 (auto re-allocation) is an *addition* to it, deferred post-race.
- **The `DisciplineStrategy` seam** (`strategy.ts`) means `swimStrategy` and the finished `bikeStrategy` drop in behind `selectStrategy()` exactly as `runStrategy` did — the periodizer, generator skeleton, readiness overlay, and feasibility framework are shared and unchanged.

The tri work is genuinely *assembly of shipped parts* plus two discipline libraries — not new physics. That's the payoff of having driven the currency + transfer + adaptation gates to completion first.

---

## 7. Realistic scope call — before vs. after June 2027

**Fits before the Jan-2027 training start (the MVP / Gate G1):**
- Finished cycling (C4/C5/C7; C6 coarse).
- Full swim leg (S0–S5; S6 manual entry + constant OW offset).
- **Manual** time budget (T1 manual), heuristic allocator with self-reported limiter + race-demand + floors (T4 core), multi-sport week with basic bricks (T5), `triStrategy` + multi-sport UI (T8).
- One race distance dialed in (pick the cohort's actual distance — likely **sprint or Olympic**, whose shorter build is more forgiving of a late start than a 70.3).

**Post-race (Gate G2 tuning → G3 productization):**
- Cohort-percentile limiter analysis (T3) + reference table built from cohort data.
- Time-budget inference from history (full T1), composite feasibility (T6), auto re-allocation (T7).
- Coefficient tuning against real cohort data (`swim→run` transfer, CSS zones, return-on-time).
- Cold-start / self-serve onboarding, unit + pool/OW robustness, multi-distance coverage — everything that turns "works for people I know" into "works for strangers."

**One-line program summary:** the currency + transfer + adaptation gates are already through, so the path to a June-2027-ready service is *finish the bike, build the swim, assemble the allocator on top* — scoped to a manual-budget, self-reported-limiter MVP that must ship by ~Dec-2026 to catch the training window, with cohort-percentile intelligence and self-serve onboarding deferred to post-race as the guinea-pig data is exactly what builds them.

---

## Sources & references

- **Prior design docs (build directly on):** `docs/multisport/cycling-engine-spec.md` (Stories 4–7 open); `docs/multisport/triathlon-time-optimization-spec.md` (§8.3 T-story sequence, ≈28–36 d full); `docs/multisport/load-currency-transfer-spec.md` (§6.2 L0–L5, T0 gate — **landed**).
- **Companion:** `swim-foundation-spec.md` (this batch) — the full swim leg (Phase B).
- **Shipped-code the plan reuses:** `src/engine/loadCurrencyLogic.ts`, `loadCurrencyFlagLogic.ts`, `transferLogic.ts`; `src/server/{fitnessTracks,monitor,adaptation}.ts`; `src/engine/plan/{strategy,bikeStrategy,ftpLogic,powerZonesLogic,runStrategy,generate,periodize,feasibility}.ts`.
- **Training-science basis (via the prior specs):** Friel *Triathlete's Training Bible* (limiters, ~10%/wk progression, event-specificity, swim frequency>duration, bricks); Seiler 2010 / Stöggl & Sperlich 2014 (intensity distribution, h-dependent polarization); Coggan/TrainingPeaks (TSS/PMC); Wakayoshi 1992 / Ginn 1993 (CSS); Gabbett 2016 (acute:chronic load / ramp guardrail).
