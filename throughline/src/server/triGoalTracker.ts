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
import { and, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { races } from '@/db/schema';
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

export interface TriGoalTracker {
  goalName: string;
  goalDate: string;
  daysAway: number;
  distance: TriDistance;
  targetFinishSeconds: number;
  feasibility: TriFeasibility;
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

  const [vdot, ftp, css, weightKg] = await Promise.all([
    getAthleteVdot(db, athleteId),
    getAthleteFtp(db, athleteId),
    getAthleteCss(db, athleteId),
    getAthleteWeightKg(db, athleteId),
  ]);
  if (vdot == null || ftp == null || css == null) return null; // need all three anchors

  const distance = race.distanceLabel as TriDistance;
  const anchors = { run: vdot, bike: ftp, swim: css };
  const riderMassKg = weightKg ?? DEFAULT_RIDER_MASS_KG;
  const msLeft = Date.parse(race.date) - Date.parse(today);
  const weeksToRace = Math.max(1, Math.round(msLeft / (7 * 86400000)));

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
  });

  return {
    goalName: race.name,
    goalDate: race.date,
    daysAway: Math.floor(msLeft / 86400000),
    distance,
    targetFinishSeconds: race.targetTimeSeconds,
    feasibility,
  };
}
