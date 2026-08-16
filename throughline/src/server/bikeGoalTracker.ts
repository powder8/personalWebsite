/**
 * Standalone cycling goal tracker — the bike-native "where do I stand?" verdict.
 * The single-sport (run) tracker is VDOT-based; a cyclist's honest target is a
 * goal FTP, so this reads current FTP + a target FTP and runs the shared
 * feasibility core + attainability ceiling (assessFtpGoal). Returns null unless
 * the athlete has an FTP anchor and a goal race, so the portal can fall back.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { races, athletes, plans } from '@/db/schema';
import { getAthleteFtp, getAthleteWeightKg, getAthleteTargetFtp } from '@/db/powerConfig';
import { assessFtpGoal, type FtpGoalAssessment } from '@/engine/plan';

export interface BikeGoalTracker {
  goalName: string;
  goalDate: string;
  daysAway: number;
  currentFtp: number;
  weightKg: number | null;
  /** null when no goal FTP is set — the tracker shows a build-state countdown. */
  assessment: FtpGoalAssessment | null;
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
    .where(and(eq(races.athleteId, athleteId), eq(races.priority, 'goal')))
    .limit(1);
  if (!race) return null;

  const ftp = await getAthleteFtp(db, athleteId);
  if (ftp == null) return null; // not a cyclist — portal falls back

  const [targetFtp, weightKg, athlete, planRow] = await Promise.all([
    getAthleteTargetFtp(db, athleteId),
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

  const assessment =
    targetFtp != null && targetFtp > 0
      ? assessFtpGoal({ currentFtp: ftp, targetFtp, weeksToRace, ageYears, massKg: weightKg ?? undefined, weeklyHours })
      : null;

  return { goalName: race.name, goalDate: race.date, daysAway, currentFtp: ftp, weightKg, assessment };
}
