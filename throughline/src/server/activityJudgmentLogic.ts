/**
 * PURE half of the activity classifier (no network, no DB).
 *
 * The provider sport mapping is a lookup table: Strava "Run" → run, "Ride" →
 * bike, anything else → other. It silently drops the odd cases — a run logged
 * as a "Workout", a walk logged as a run, a treadmill session with no GPS. This
 * asks a typed-judgment model (TypeSafe) the narrow question instead, from the
 * numbers we already hold, and records the answer NEXT TO the mapping.
 *
 * SHADOW MODE: nothing here changes `sport`. We surface where the model and the
 * mapping disagree, and only promote the model once it has earned it.
 */
import { choice, noul } from '@typesafe-ai/sdk';

export type JudgedSport = 'run' | 'bike' | 'swim' | 'strength' | 'walk' | 'other';

/** What the model returns, stored on the activity. */
export interface ActivityJudgment {
  sport: JudgedSport;
  confidence: number; // how peaked the sport distribution is, 0–1
  probabilities: Record<JudgedSport, number>;
  /** Probability this was a race / all-out competitive effort. */
  race: number;
  model: string;
  judgedAt: string; // ISO
}

/** The activity facts the model sees — only what we already store. */
export interface ActivityFacts {
  name: string | null;
  providerSport: string; // what the mapping currently says
  workoutType: number | null; // Strava: 1 = race
  distanceMeters: number | null;
  durationSeconds: number | null;
  avgHr: number | null;
  maxHr: number | null;
  cadence: number | null;
  elevationGainMeters: number | null;
  surface: string | null;
}

/** Derived numbers that make the sport obvious to a model (and a human). */
export function buildState(a: ActivityFacts) {
  const km = (a.distanceMeters ?? 0) / 1000;
  const h = (a.durationSeconds ?? 0) / 3600;
  const speedKph = km > 0 && h > 0 ? Math.round((km / h) * 10) / 10 : null;
  const paceMinPerKm = km > 0 && a.durationSeconds ? Math.round(((a.durationSeconds / 60) / km) * 10) / 10 : null;
  return {
    title: a.name,
    provider_says: a.providerSport,
    provider_flagged_race: a.workoutType === 1,
    distance_km: km > 0 ? Math.round(km * 100) / 100 : null,
    duration_min: a.durationSeconds ? Math.round(a.durationSeconds / 60) : null,
    avg_speed_kph: speedKph,
    avg_pace_min_per_km: paceMinPerKm,
    avg_hr_bpm: a.avgHr,
    max_hr_bpm: a.maxHr,
    // Strava stores cadence as spm for runs and rpm for rides — say so.
    cadence: a.cadence != null ? { value: a.cadence, note: 'steps/min if running, revolutions/min if cycling' } : null,
    elevation_gain_m: a.elevationGainMeters,
    surface: a.surface,
  };
}

/** Narrow, closed questions — the model never gets to invent a category. */
export const QUESTIONS = {
  sport: choice('Which sport is this logged activity, judging from the numbers rather than the title?', {
    run: 'running, including treadmill and trail; typical pace 3.5–9 min/km, cadence ~150–190 steps/min',
    bike: 'cycling or riding, indoor or outdoor; typical speed 15–45 km/h, cadence ~60–110 rpm',
    swim: 'swimming, pool or open water; short distance, very slow speed, no elevation',
    strength: 'gym, weights, or a strength circuit; little or no distance',
    walk: 'walking or hiking; pace slower than ~9 min/km, low heart rate for the distance',
    other: 'none of the above, or not enough information to tell',
  }),
  race: noul('Was this a race or an all-out competitive effort, rather than a training session?', {
    true: 'a race, time trial, or maximal test effort',
    false: 'ordinary training, however hard',
  }),
} as const;

/** Only flag a disagreement the model is actually sure about. */
export const DISAGREE_CONFIDENCE = 0.7;
/** Flag "the model thinks this was a race" only when it's confident and the provider didn't say so. */
export const RACE_THRESHOLD = 0.8;

export type Disagreement =
  | { kind: 'sport'; from: string; to: JudgedSport; confidence: number }
  | { kind: 'race'; probability: number };

/** Where the model and the provider mapping part ways, with enough confidence to matter. */
export function disagreements(providerSport: string, workoutType: number | null, j: ActivityJudgment): Disagreement[] {
  const out: Disagreement[] = [];
  if (j.sport !== providerSport && j.confidence >= DISAGREE_CONFIDENCE) {
    out.push({ kind: 'sport', from: providerSport, to: j.sport, confidence: j.confidence });
  }
  if (j.race >= RACE_THRESHOLD && workoutType !== 1) {
    out.push({ kind: 'race', probability: j.race });
  }
  return out;
}
