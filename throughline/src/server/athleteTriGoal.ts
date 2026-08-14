/**
 * Athlete-facing TRIATHLON goal setup — the multi-sport twin of athleteGoal.ts.
 * Collects the three anchors (run VDOT via a recent race, bike FTP + weight,
 * swim CSS via a 400/200 test), a target finish, weekly hours, and the
 * self-reported limiter, sets the configs, then generates + publishes a
 * multi-sport plan via setupTriSeason. Self-service → autonomous coaching.
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes } from '@/db/schema';
import { setupTriSeason, type TriSeasonSetupResult } from '@/server/triSeason';
import { setAthletePaceConfig } from '@/db/paceConfig';
import { setAthletePowerConfig } from '@/db/powerConfig';
import { setAthleteSwimConfig } from '@/db/swimConfig';
import { vdotFromRace, cssFrom400_200, buildWeekSchedule, TRI_DISTANCE_METERS, type Discipline, type TriDistance } from '@/engine/plan';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DISTANCE_NAME: Record<TriDistance, string> = {
  sprint: 'Sprint Triathlon',
  olympic: 'Olympic Triathlon',
  '70.3': 'Half Iron (70.3)',
  ironman: 'Ironman (140.6)',
};

export interface TriGoalInput {
  distance: TriDistance;
  date: string; // race day, YYYY-MM-DD
  targetFinishSeconds?: number; // optional target finish
  weeklyHours: number;
  limiter: Discipline;
  /** Run anchor: a recent race (preferred) or an explicit VDOT. */
  run: { vdot?: number; race?: { distanceMeters: number; timeSeconds: number } };
  /** Bike anchor: FTP watts (+ body mass for the goal-time model). */
  bike: { ftpWatts: number; weightKg?: number };
  /** Swim anchor: an explicit CSS or a 400 m + 200 m time-trial pair. */
  swim: { cssMetersPerSec?: number; test?: { t400Sec: number; t200Sec: number } };
  /** DOB drives the attainability ceiling; set here if not already on file. */
  dateOfBirth?: string;
  /**
   * Real-world weekly availability (day-of-week: 0=Mon…6=Sun). When given, the
   * plan is laid onto these windows — swims only on pool days, long/brick on the
   * long day. Absent → the generators' native placement.
   */
  schedule?: { availableDays: number[]; poolDays: number[]; longDay?: number };
}

export async function setupAthleteTriGoal(
  db: DB,
  athleteId: string,
  today: string,
  input: TriGoalInput,
): Promise<TriSeasonSetupResult> {
  if (!input.date || !DATE_RE.test(input.date)) throw new Error('Pick your race date (YYYY-MM-DD).');
  if (input.date <= today) throw new Error('Your race date needs to be in the future.');

  // --- Run anchor (VDOT) ---
  if (input.run.race && input.run.race.timeSeconds > 0 && input.run.race.distanceMeters > 0) {
    const vdot = vdotFromRace(input.run.race);
    await setAthletePaceConfig(db, athleteId, { vdot });
  } else if (input.run.vdot && input.run.vdot > 0) {
    await setAthletePaceConfig(db, athleteId, { vdot: input.run.vdot });
  } else {
    throw new Error('Add a recent run race (distance + time) so we can set your run fitness.');
  }

  // --- Bike anchor (FTP) ---
  if (!(input.bike.ftpWatts > 0)) throw new Error('Enter your cycling FTP in watts.');
  await setAthletePowerConfig(db, athleteId, {
    ftpWatts: Math.round(input.bike.ftpWatts),
    weightKg: input.bike.weightKg && input.bike.weightKg > 0 ? input.bike.weightKg : undefined,
  });

  // --- Swim anchor (CSS) ---
  let css = input.swim.cssMetersPerSec;
  if ((css == null || css <= 0) && input.swim.test) {
    css = cssFrom400_200(input.swim.test.t400Sec, input.swim.test.t200Sec) ?? undefined;
  }
  if (!(css && css > 0)) {
    throw new Error('Add your swim CSS, or a 400 m and 200 m time-trial to compute it.');
  }
  await setAthleteSwimConfig(db, athleteId, { cssMetersPerSec: css });

  // --- DOB (for the ceiling) — set only if provided and not already stronger data. ---
  if (input.dateOfBirth && DATE_RE.test(input.dateOfBirth)) {
    await db.update(athletes).set({ dateOfBirth: input.dateOfBirth, updatedAt: new Date() }).where(eq(athletes.id, athleteId));
  }

  const legs = TRI_DISTANCE_METERS[input.distance];
  const result = await setupTriSeason(db, athleteId, {
    startDay: today,
    goalRace: {
      name: DISTANCE_NAME[input.distance],
      date: input.date,
      distance: input.distance,
      distanceMeters: legs.swimMeters + legs.bikeMeters + legs.runMeters,
    },
    weeklyHours: input.weeklyHours,
    limiter: input.limiter,
    goalFinishSeconds: input.targetFinishSeconds,
    schedule:
      input.schedule && input.schedule.availableDays.length > 0
        ? buildWeekSchedule({
            availableDays: input.schedule.availableDays,
            poolDays: input.schedule.poolDays,
            longDay: input.schedule.longDay,
          })
        : undefined,
    publish: true,
  });

  // Self-service = no human coach → autonomous mode, onboarding done.
  await db
    .update(athletes)
    .set({ coachingMode: 'autonomous', onboardedAt: new Date(), updatedAt: new Date() })
    .where(eq(athletes.id, athleteId));

  return result;
}
