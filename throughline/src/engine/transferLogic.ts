/**
 * Cross-sport fitness-transfer model — the multi-track PMC (spec story L3).
 *
 * PURE (no `server-only`, no DB, no clock). Builds on the unified TSS-equivalent
 * currency (`loadCurrencyLogic.ts` / `loadSelectLogic.ts`): every activity's daily
 * load is already a comparable, summable "threshold-hour" number. This module
 * decides HOW MUCH of that load counts toward each of three separable buckets of
 * endurance fitness, and layers them onto the SAME Banister kernel
 * (`fitnessFatigue.ts`) as three parallel tracks.
 *
 * The physiological split (spec §3.1, with citations):
 *
 *   • CENTRAL / transferable — cardiac output (stroke volume, plasma volume) and
 *     the general oxidative machinery. Trained by systemic aerobic stress in ANY
 *     modality, so it TRANSFERS across sports. (Clausen 1977, Physiol Rev;
 *     Bassett & Howley 2000, MSSE — VO₂max is limited primarily by central
 *     cardiac output.)
 *   • SPECIFIC / economy — recruited-muscle capillarity/mitochondria and the
 *     neuromuscular EFFICIENCY of the movement. Largely NON-transferable; built
 *     only by doing the sport. (Saltin et al. 1976 one-leg training; Rud/Holloszy
 *     muscle-specific mitochondrial adaptation.)
 *   • DURABILITY / impact — tendon/bone/connective-tissue and eccentric-loading
 *     resilience. Running's ~2–3× bodyweight impact per stride has NO low-impact
 *     equivalent, so bike/swim confer ~none of it. (Millet, Vleck & Bentley 2009;
 *     Tanaka 1994 — cross-training preserves VO₂max but sport-specific
 *     performance/durability needs sport-specific work; Wilber et al. 1996 —
 *     deep-water running maintains VO₂max and partial run-specificity.)
 *
 * The three tracks all use the SAME time constants as the live single PMC
 * (`DEFAULT_FF_OPTIONS`, τ 42/7). That is DELIBERATE: it guarantees that for a
 * run-only athlete every track is BYTE-IDENTICAL to today's single curve
 * (run→run coefficients are all 1.0), so their readiness/feasibility is unchanged.
 * A slower durability τ (bone/tendon adapt over weeks–months, spec §3.3) is a
 * tempting refinement but would break that exact equality; it is deferred to L4/L5
 * and called out in the final report.
 *
 * Coefficients are DEFENSIBLE STARTING VALUES with citations, intended to be tuned
 * global→athlete exactly like `GlobalPaceModel` / `GlobalPowerModel` (spec §3.2).
 */
import { computeFitnessFatigue, DEFAULT_FF_OPTIONS, type FitnessFatigueOptions } from './fitnessFatigue';
import type { DailyReading, FitnessFatiguePoint } from './types';

// ---------------------------------------------------------------------------
// Sports, disciplines, components
// ---------------------------------------------------------------------------

/**
 * Source modalities the transfer model understands. A superset of `db.sportEnum`
 * (run/bike/swim/strength/cross_train/other): it also names `pool_run` and
 * `elliptical`, which the DB can't yet distinguish but the L5 impact-substitution
 * policy will synthesize. {@link fromDbSport} maps the stored enum in.
 */
export type TransferSport =
  | 'run'
  | 'bike'
  | 'swim'
  | 'pool_run'
  | 'elliptical'
  | 'strength'
  | 'cross_train'
  | 'other';

/** A target discipline whose fitness we track (the three PMC-bearing sports). */
export type Discipline = 'run' | 'bike' | 'swim';

/** The three components of one activity's load, for one source→target pair. */
export interface TransferCoeffs {
  /** Transferable central-aerobic fraction (feeds the central track). */
  central: number;
  /** Sport-specific economy/skill fraction (feeds the specific track). */
  economy: number;
  /** Musculoskeletal / impact-tolerance fraction (feeds the durability track). */
  durability: number;
}

/** The three PMC tracks per athlete-discipline. */
export type TrackComponent = 'central' | 'specific' | 'durability';

/** All three components, in a fixed order (handy for iteration). */
export const TRACK_COMPONENTS: readonly TrackComponent[] = ['central', 'specific', 'durability'];

// ---------------------------------------------------------------------------
// The coefficient table (spec §3.2)
// ---------------------------------------------------------------------------

/**
 * Ordered-pair transfer coefficients, keyed [target discipline][source sport].
 *
 * Every diagonal (same sport → same sport) is the identity {1,1,1}: full credit
 * to all three tracks. That identity is what makes a run-only athlete's three
 * tracks collapse onto today's single PMC.
 *
 * Cross terms: CENTRAL transfer is high and roughly symmetric between the two
 * leg-driven land sports (bike↔run), lower from the upper-body/horizontal swim,
 * and highest from same-gait low-impact surrogates (pool-run, elliptical).
 * ECONOMY and DURABILITY are near-zero across modalities — the whole point of the
 * model. Sources: Millet/Vleck/Bentley 2009; Tanaka 1994; Wilber et al. 1996;
 * Clausen 1977; Bassett & Howley 2000; Saltin et al. 1976.
 *
 * NB: `swim→run` central is set to 0.60 per the L3 build directive; the spec's
 * §3.2 table quotes a lower 0.30–0.50 band for swim→land central transfer. The
 * higher value is used here as the tunable starting point and flagged for review.
 * Swim-TARGET rows (land→swim) are the lowest-confidence entries (swim is
 * technique/upper-body dominant); they exist for completeness and are tunable.
 */
export const TRANSFER_TABLE: Readonly<
  Record<Discipline, Readonly<Partial<Record<TransferSport, TransferCoeffs>>>>
> = {
  run: {
    run: { central: 1.0, economy: 1.0, durability: 1.0 }, // identity
    bike: { central: 0.75, economy: 0.1, durability: 0.0 }, // big engine, no impact. Millet 2009
    pool_run: { central: 0.9, economy: 0.5, durability: 0.3 }, // same gait, no ground impact. Wilber 1996
    elliptical: { central: 0.78, economy: 0.32, durability: 0.1 }, // run-like leg cycle, minimal impact
    swim: { central: 0.6, economy: 0.0, durability: 0.0 }, // upper-body dominant (see note above)
    strength: { central: 0.15, economy: 0.05, durability: 0.15 }, // some tendon/bone loading
    cross_train: { central: 0.4, economy: 0.05, durability: 0.05 }, // generic aerobic
    other: { central: 0.3, economy: 0.0, durability: 0.0 },
  },
  bike: {
    bike: { central: 1.0, economy: 1.0, durability: 1.0 }, // identity
    run: { central: 0.78, economy: 0.1, durability: 0.2 }, // aerobic base carries; little pedaling economy
    pool_run: { central: 0.55, economy: 0.1, durability: 0.1 },
    elliptical: { central: 0.62, economy: 0.2, durability: 0.15 },
    swim: { central: 0.4, economy: 0.0, durability: 0.05 }, // spec §3.2 swim→bike 0.30-0.50
    strength: { central: 0.15, economy: 0.05, durability: 0.2 },
    cross_train: { central: 0.45, economy: 0.05, durability: 0.15 },
    other: { central: 0.3, economy: 0.0, durability: 0.05 },
  },
  swim: {
    swim: { central: 1.0, economy: 1.0, durability: 1.0 }, // identity
    run: { central: 0.25, economy: 0.0, durability: 0.05 }, // little leg-muscle/technique overlap
    bike: { central: 0.25, economy: 0.0, durability: 0.05 },
    pool_run: { central: 0.3, economy: 0.05, durability: 0.1 }, // in-water, some feel
    elliptical: { central: 0.22, economy: 0.0, durability: 0.05 },
    strength: { central: 0.15, economy: 0.1, durability: 0.2 }, // pull strength aids swim a little
    cross_train: { central: 0.25, economy: 0.0, durability: 0.05 },
    other: { central: 0.2, economy: 0.0, durability: 0.0 },
  },
};

/**
 * Conservative fallback for a source with no explicit row under a target: a small
 * generic aerobic carryover, no economy, no durability. Keeps the model total
 * even for exotic/unmapped modalities.
 */
export const DEFAULT_CROSS_COEFFS: TransferCoeffs = { central: 0.25, economy: 0.0, durability: 0.0 };

/** Map a stored `db.sportEnum` value into the transfer model's sport space. */
export function fromDbSport(
  sport: 'run' | 'bike' | 'swim' | 'strength' | 'cross_train' | 'other',
): TransferSport {
  return sport; // identity, every enum member is a TransferSport too
}

/**
 * Transfer coefficients for one ordered pair. The same-sport diagonal is always
 * the identity even if the table were edited; unmapped pairs fall back to
 * {@link DEFAULT_CROSS_COEFFS}.
 */
export function transferCoeffs(source: TransferSport, target: Discipline): TransferCoeffs {
  if ((source as string) === target) return { central: 1.0, economy: 1.0, durability: 1.0 };
  return TRANSFER_TABLE[target][source] ?? DEFAULT_CROSS_COEFFS;
}

/**
 * Split one activity's daily load into its three track contributions for a target
 * discipline: `component = coeff × load`. Same-sport load passes through at full
 * value to all three tracks.
 */
export function splitLoad(source: TransferSport, load: number, target: Discipline): TransferCoeffs {
  const c = transferCoeffs(source, target);
  return { central: c.central * load, economy: c.economy * load, durability: c.durability * load };
}

// ---------------------------------------------------------------------------
// The multi-track PMC
// ---------------------------------------------------------------------------

/** One activity's already-computed daily load in the unified currency. */
export interface TrackActivity {
  day: string; // 'YYYY-MM-DD'
  sport: TransferSport;
  load: number; // TSS-equivalent daily load (from selectDailyLoad)
}

/** The three parallel PMC series for one target discipline. */
export interface FitnessTracks {
  discipline: Discipline;
  /** Transferable central-aerobic fitness — ALL sports feed, weighted by central coeff. */
  central: FitnessFatiguePoint[];
  /** Sport-specific fitness/economy — weighted by the economy coeff. */
  specific: FitnessFatiguePoint[];
  /** Musculoskeletal durability — impact-bearing load only, weighted by durability coeff. */
  durability: FitnessFatiguePoint[];
}

/**
 * Compute the three tracks for one target discipline over [from, to].
 *
 * Each track is the SAME Banister kernel over a differently-weighted daily-load
 * stream: central uses the central coefficient, specific the economy coefficient,
 * durability the durability coefficient. Because run→run coefficients are all 1.0,
 * a run-only athlete's three tracks are identical to `computeFitnessFatigue` over
 * the raw run loads — i.e. today's single PMC.
 *
 * The same `opts` (default τ 42/7) is used for all three tracks to preserve that
 * exact equality; see the module header on the deferred durability-τ refinement.
 */
export function computeFitnessTracks(
  activities: TrackActivity[],
  target: Discipline,
  from: string,
  to: string,
  opts: FitnessFatigueOptions = DEFAULT_FF_OPTIONS,
): FitnessTracks {
  const central: DailyReading[] = [];
  const specific: DailyReading[] = [];
  const durability: DailyReading[] = [];
  for (const a of activities) {
    const s = splitLoad(a.sport, a.load, target);
    central.push({ day: a.day, value: s.central });
    specific.push({ day: a.day, value: s.economy });
    durability.push({ day: a.day, value: s.durability });
  }
  return {
    discipline: target,
    central: computeFitnessFatigue(central, from, to, opts),
    specific: computeFitnessFatigue(specific, from, to, opts),
    durability: computeFitnessFatigue(durability, from, to, opts),
  };
}

// ---------------------------------------------------------------------------
// Storage discriminator (spec §3.3)
// ---------------------------------------------------------------------------

/**
 * The `fitness_fatigue_states.track` discriminator for a (component, discipline).
 * Format `"<component>:<discipline>"`, e.g. `central:run`, `durability:run`. The
 * spec's bare `central` is generalized to `central:<discipline>` so multisport
 * athletes can carry central:bike / central:swim too; for a run-only athlete
 * `central:run` reproduces the exact legacy single-PMC series.
 */
export function trackId(component: TrackComponent, discipline: Discipline): string {
  return `${component}:${discipline}`;
}

/** Inverse of {@link trackId}; returns null for an unrecognized string. */
export function parseTrackId(id: string): { component: TrackComponent; discipline: Discipline } | null {
  const [component, discipline] = id.split(':');
  if (!TRACK_COMPONENTS.includes(component as TrackComponent)) return null;
  if (discipline !== 'run' && discipline !== 'bike' && discipline !== 'swim') return null;
  return { component: component as TrackComponent, discipline: discipline as Discipline };
}

// ---------------------------------------------------------------------------
// Consulting the tracks (spec §3.4) — WHICH track answers WHICH question
// ---------------------------------------------------------------------------

/** The last point of a track (today's state), or null for an empty series. */
function currentOf(series: FitnessFatiguePoint[]): FitnessFatiguePoint | null {
  return series[series.length - 1] ?? null;
}

/**
 * AEROBIC-CAPACITY read — "can the athlete metabolically sustain the effort?"
 * Reads the CENTRAL track (spec §3.4): bike/pool/elliptical hours legitimately
 * raise this (discounted by their central coefficient). Never blocked by
 * durability.
 */
export function aerobicCapacity(tracks: FitnessTracks): { ctl: number; atl: number; tsb: number } | null {
  const c = currentOf(tracks.central);
  return c ? { ctl: c.ctl, atl: c.atl, tsb: c.tsb } : null;
}

/** How much a durability-limited ramp may exceed chronic durability load per week. */
export const DURABILITY_WEEKLY_RAMP = 1.1; // +10%/week, the classic safe progression

export interface RunVolumeSafety {
  /** Chronic durability load (durability-track CTL) — the legs' absorbed run load. */
  durabilityCtl: number;
  /** Central-track CTL, for contrast (the engine). */
  centralCtl: number;
  /**
   * Safe weekly TSS-equivalent run load ceiling: a week at chronic durability plus
   * the standard ramp allowance. This is what caps run-volume prescriptions —
   * NEVER central CTL (spec §3.4).
   */
  safeWeeklyLoadCap: number;
  /**
   * True when durability lags central (a cross-trainer whose engine outruns their
   * legs). False for a run-only athlete, where the two tracks are equal — so the
   * cap derived from durability equals the one central would give and NOTHING
   * about the run-only output changes.
   */
  limitedByDurability: boolean;
}

/**
 * RUN-VOLUME-SAFETY read — "is this long run / this weekly run mileage safe?"
 * Reads the DURABILITY track, never central (spec §3.4). This is the guardrail
 * that stops a big central engine from justifying run volume the legs haven't
 * earned. For a run-only athlete durability == central, so `limitedByDurability`
 * is false and the cap is identical to a central-derived one: output unchanged.
 */
export function runVolumeSafety(tracks: FitnessTracks, epsilon = 1e-9): RunVolumeSafety {
  const dur = currentOf(tracks.durability);
  const cen = currentOf(tracks.central);
  const durabilityCtl = dur?.ctl ?? 0;
  const centralCtl = cen?.ctl ?? 0;
  return {
    durabilityCtl,
    centralCtl,
    safeWeeklyLoadCap: durabilityCtl * 7 * DURABILITY_WEEKLY_RAMP,
    limitedByDurability: durabilityCtl < centralCtl - epsilon,
  };
}
