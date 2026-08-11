# Multi-sport expansion — design specs

Throughline is expanding from running-only to **cycling → triathlon**. These are
the design blueprints for that work. They are living design docs (not final
API contracts); the engine seam they build on is the `DisciplineStrategy` in
`src/engine/plan/strategy.ts`.

| Spec | What it designs | Status |
|---|---|---|
| [cycling-engine-spec.md](./cycling-engine-spec.md) | `bikeStrategy`: FTP anchor, Coggan power/HR zones, power×duration workouts, TSS periodization, events | Story 0 (seam) + Story 1 (FTP anchor + zones) **shipped**; workouts/periodize/feasibility/UI pending |
| [load-currency-transfer-spec.md](./load-currency-transfer-spec.md) | Unified TSS-equivalent load currency across sports + cross-sport fitness transfer (central-aerobic vs sport-specific) + impact-substitution preference | **T0 gate** — blocks cycling periodization and the tri allocator; L0–L2 (currency + non-destructive backfill + diff report) is the safe, no-cutover foundation |
| [triathlon-time-optimization-spec.md](./triathlon-time-optimization-spec.md) | `triStrategy` + time-budget allocator: best results within realistically-available hours (limiter analysis, return-on-time, race-demand weighting) | Design only; depends on the unified load currency |

## Key open decision
The load-currency cutover **renumbers existing athletes' fitness/fatigue charts**
(same shape, rescaled absolute values). It ships only after the offline diff
report (generated on a replica, never prod) is reviewed and signed off. See the
migration section of the load-currency spec.
