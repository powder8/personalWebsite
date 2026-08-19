/**
 * Standalone cycling goal tracker — the bike-native "where do I stand?". Two
 * kinds of goal, both honest:
 *  - a RACE finish time on a specific course (distance + total elevation) →
 *    assessBikeRaceGoal (the elevation-aware time model + attainability ceiling);
 *  - a goal FTP (a power number) → assessFtpGoal.
 * Falls back to a build-state countdown when neither is set. Returns null unless
 * the athlete has an FTP anchor and a goal race, so the portal can fall back.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { races, athletes, plans } from '@/db/schema';
import { getAthleteFtp, getAthleteWeightKg, getAthleteTargetFtp, getAthleteGoalElevation } from '@/db/powerConfig';
import {
  assessFtpGoal,
  assessBikeRaceGoal,
  DEFAULT_RIDER_MASS_KG,
  type FtpGoalAssessment,
  type BikeRaceGoalAssessment,
} from '@/engine/plan';

export interface BikeGoalTracker {
  goalName: string;
  goalDate: string;
  daysAway: number;
  currentFtp: number;
  weightKg: number | null;
  /** A race finish-time goal on a course (distance + elevation), when set. */
  raceGoal: BikeRaceGoalAssessment | null;
  /** Race distance / climbing, for display (present with a race goal). */
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  /** A goal-FTP verdict, when no race-time goal is set but a target FTP is. */
  ftpGoal: FtpGoalAssessment | null;
}

function ageAt(dob: string, onDay: string): number {
  const [by, bm, bd] = dob.split('-').map(Number);
  const [oy, om, od] = onDay.split('-').map(Number);
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age -= 1;
  return age;
}

export async function getBikeGoalTracker(
  db: DB,
  athleteId: string,
  today: string,
): Promise<BikeGoalTracker | null> {
  const [race] = await db
    .select()
    .from(races)
    .where(and(eq(races.athleteId, athleteId), eq(races.priority, 'goal'), eq(races.discipline, 'bike')))
    .limit(1);
  if (!race) return null;

  const ftp = await getAthleteFtp(db, athleteId);
  if (ftp == null) return null; // not a cyclist, portal falls back

  const [targetFtp, elevation, weightKg, athlete, planRow] = await Promise.all([
    getAthleteTargetFtp(db, athleteId),
    getAthleteGoalElevation(db, athleteId),
    getAthleteWeightKg(db, athleteId),
    db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1).then((r) => r[0]),
    db
      .select({ generatedFrom: plans.generatedFrom })
      .from(plans)
      .where(eq(plans.athleteId, athleteId))
      .orderBy(desc(plans.createdAt))
      .limit(1)
      .then((r) => r[0]),
  ]);

  const msLeft = Date.parse(race.date) - Date.parse(today);
  const daysAway = Math.floor(msLeft / 86400000);
  const weeksToRace = Math.max(1, Math.round(msLeft / (7 * 86400000)));
  const ageYears = athlete?.dateOfBirth ? ageAt(athlete.dateOfBirth, race.date) : undefined;
  const weeklyHours = (planRow?.generatedFrom as { weeklyHours?: number } | null)?.weeklyHours;
  const riderMassKg = weightKg ?? DEFAULT_RIDER_MASS_KG;

  // A RACE finish-time goal takes precedence — it's the "can I do this event in
  // time X?" question. Needs distance + a target time; elevation defaults to flat.
  let raceGoal: BikeRaceGoalAssessment | null = null;
  if (race.targetTimeSeconds != null && race.targetTimeSeconds > 0 && race.distanceMeters != null && race.distanceMeters > 0) {
    raceGoal = assessBikeRaceGoal({
      currentFtp: ftp,
      targetTimeSeconds: race.targetTimeSeconds,
      distanceMeters: race.distanceMeters,
      elevationGainMeters: elevation ?? 0,
      riderMassKg,
      weeksToRace,
      ageYears,
      weeklyHours,
    });
  }

  const ftpGoal =
    !raceGoal && targetFtp != null && targetFtp > 0
      ? assessFtpGoal({ currentFtp: ftp, targetFtp, weeksToRace, ageYears, massKg: riderMassKg, weeklyHours })
      : null;

  return {
    goalName: race.name,
    goalDate: race.date,
    daysAway,
    currentFtp: ftp,
    weightKg,
    raceGoal,
    distanceMeters: race.distanceMeters ?? null,
    elevationGainMeters: elevation ?? null,
    ftpGoal,
  };
}
