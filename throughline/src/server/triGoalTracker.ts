/**
 * Multi-sport goal tracker (spec G8) — the triathlon twin of goalTracker.ts.
 * Reads the athlete's TIMED tri goal (persisted by setupTriSeason as a
 * `goalType:'time'` race on a tri distance) + their three anchors, and
 * recomputes the per-leg decomposition + binding-leg feasibility on the fly
 * (both are cheap pure functions — nothing derived is persisted).
 *
 * Returns null unless the athlete actually has a timed triathlon goal AND all
 * three anchors, so the portal can fall back to the single-sport tracker.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { races, athletes, plans } from '@/db/schema';
import { getAthleteVdot } from '@/db/paceConfig';
import { getAthleteFtp, getAthleteWeightKg } from '@/db/powerConfig';
import { getAthleteCss } from '@/db/swimConfig';
import {
  decomposeGoalTime,
  assessTriFeasibility,
  DEFAULT_RIDER_MASS_KG,
  type TriDistance,
  type TriFeasibility,
} from '@/engine/plan';

const TRI_DISTANCES = new Set<string>(['sprint', 'olympic', '70.3', 'ironman']);

/** Placeholder swim CSS (m/s) used when swim training hasn't started — roughly a
 *  novice-triathlete threshold (~1:40/100m). Only shapes the deferred swim leg's
 *  provisional split; it never drives a verdict (the leg is marked deferred). */
const DEFERRED_SWIM_CSS = 1.0;

/** Whole years old at `onDay` given a 'YYYY-MM-DD' date of birth. */
function ageAt(dob: string, onDay: string): number {
  const [by, bm, bd] = dob.split('-').map(Number);
  const [oy, om, od] = onDay.split('-').map(Number);
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age -= 1;
  return age;
}

export interface TriGoalTracker {
  goalName: string;
  goalDate: string;
  daysAway: number;
  distance: TriDistance;
  targetFinishSeconds: number;
  feasibility: TriFeasibility;
  /** True when swim training hasn't started yet — the swim leg is provisional. */
  swimDeferred: boolean;
}

export async function getTriGoalTracker(
  db: DB,
  athleteId: string,
  today: string,
): Promise<TriGoalTracker | null> {
  const [race] = await db
    .select()
    .from(races)
    .where(and(eq(races.athleteId, athleteId), eq(races.priority, 'goal')))
    .limit(1);
  if (!race || race.goalType !== 'time' || race.targetTimeSeconds == null) return null;
  if (!race.distanceLabel || !TRI_DISTANCES.has(race.distanceLabel)) return null;

  const [vdot, ftp, css, weightKg, athlete] = await Promise.all([
    getAthleteVdot(db, athleteId),
    getAthleteFtp(db, athleteId),
    getAthleteCss(db, athleteId),
    getAthleteWeightKg(db, athleteId),
    db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1).then((r) => r[0]),
  ]);
  // Need the sports you're actually TRAINING (bike + run). Swim can come later
  // in a phased build — when there's no CSS yet we defer it: a placeholder anchor
  // keeps the bike/run decomposition strength-relative, and the swim leg is
  // reported as "not training yet" rather than given a misleading verdict.
  if (vdot == null || ftp == null) return null;
  const swimDeferred = css == null;
  const swimAnchor = css ?? DEFERRED_SWIM_CSS;

  const distance = race.distanceLabel as TriDistance;
  const anchors = { run: vdot, bike: ftp, swim: swimAnchor };
  const riderMassKg = weightKg ?? DEFAULT_RIDER_MASS_KG;
  const msLeft = Date.parse(race.date) - Date.parse(today);
  const weeksToRace = Math.max(1, Math.round(msLeft / (7 * 86400000)));

  // Age at race day (from DOB) enables the attainability ceiling; weekly hours
  // (persisted on the tri plan meta) scales the gain rate — both keep the portal
  // verdict consistent with what onboarding showed.
  const ageYears = athlete?.dateOfBirth ? ageAt(athlete.dateOfBirth, race.date) : undefined;
  const [planRow] = await db
    .select({ generatedFrom: plans.generatedFrom })
    .from(plans)
    .where(eq(plans.athleteId, athleteId))
    .orderBy(desc(plans.createdAt))
    .limit(1);
  const weeklyHours = (planRow?.generatedFrom as { weeklyHours?: number } | null)?.weeklyHours;

  const decomposition = decomposeGoalTime({
    distance,
    targetFinishSeconds: race.targetTimeSeconds,
    anchors,
    riderMassKg,
  });
  const feasibility = assessTriFeasibility({
    decomposition,
    currentAnchors: anchors,
    weeksToRace,
    riderMassKg,
    ageYears,
    weeklyHours,
    deferred: swimDeferred ? ['swim'] : undefined,
  });

  return {
    goalName: race.name,
    goalDate: race.date,
    daysAway: Math.floor(msLeft / 86400000),
    distance,
    targetFinishSeconds: race.targetTimeSeconds,
    feasibility,
    swimDeferred,
  };
}
