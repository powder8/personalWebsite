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
import { vdotFromRace, cssFrom400_200, buildWeekSchedule, TRI_DISTANCE_METERS, DEFAULT_RIDER_MASS_KG, type Discipline, type TriDistance } from '@/engine/plan';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Starter fitness when a triathlete has no test data yet. Deliberately
 * CONSERVATIVE — an estimate that's a touch low just gives easy early weeks, while
 * one that's too high prescribes paces/watts they can't hit (and risks injury).
 * Both seed as 'auto' anchors so real performance refines them (see setup above).
 */
const STARTER_VDOT = 40; // ~10K in 50:00, 5K in 24:00 — mid recreational.
const STARTER_BIKE_WPERKG = 2.2; // ~a first-season triathlete's threshold W/kg.

const DISTANCE_NAME: Record<TriDistance, string> = {
  sprint: 'Sprint Triathlon',
  olympic: 'Olympic Triathlon',
  '70.3': 'Half Iron (70.3)',
  ironman: 'Ironman (140.6)',
};

export interface TriGoalInput {
  distance: TriDistance;
  /** The athlete's own race name (e.g. "Maryland Triathlon"). Falls back to the
   *  distance name ("Olympic Triathlon") when blank. */
  name?: string;
  date: string; // race day, YYYY-MM-DD
  targetFinishSeconds?: number; // optional target finish
  weeklyHours: number;
  limiter: Discipline;
  /** Run anchor: a recent race (preferred) or an explicit VDOT. Omit both and we
   *  seed a conservative starter estimate that refines from real runs. */
  run: { vdot?: number; race?: { distanceMeters: number; timeSeconds: number } };
  /** Bike anchor: FTP watts (+ body mass for the goal-time model). Omit FTP and
   *  we estimate it from body mass; a real number or test supersedes it later. */
  bike: { ftpWatts?: number; weightKg?: number };
  /** Swim anchor: an explicit CSS or a 400 m + 200 m time-trial pair. */
  /** Optional: omit when swim training starts in a later block (phased tri). */
  swim?: { cssMetersPerSec?: number; test?: { t400Sec: number; t200Sec: number } };
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

  // --- Run anchor (VDOT) — a real race/VDOT is 'manual'; with nothing to go on
  //     we seed a conservative STARTER estimate tagged 'auto', so ensureAutoAnchor
  //     replaces it with the athlete's best real run the moment one syncs. ---
  if (input.run.race && input.run.race.timeSeconds > 0 && input.run.race.distanceMeters > 0) {
    await setAthletePaceConfig(db, athleteId, { vdot: vdotFromRace(input.run.race), anchorSource: 'manual' });
  } else if (input.run.vdot && input.run.vdot > 0) {
    await setAthletePaceConfig(db, athleteId, { vdot: input.run.vdot, anchorSource: 'manual' });
  } else {
    await setAthletePaceConfig(db, athleteId, { vdot: STARTER_VDOT, anchorSource: 'auto' });
  }

  // --- Bike anchor (FTP) — real FTP is 'manual'; otherwise estimate from body
  //     mass (STARTER_BIKE_WPERKG × kg) and tag 'auto' so a later FTP test or a
  //     manual number cleanly supersedes it. ---
  const bikeWeightKg = input.bike.weightKg && input.bike.weightKg > 0 ? input.bike.weightKg : undefined;
  if (input.bike.ftpWatts != null && input.bike.ftpWatts > 0) {
    await setAthletePowerConfig(db, athleteId, { ftpWatts: Math.round(input.bike.ftpWatts), weightKg: bikeWeightKg, anchorSource: 'manual' });
  } else {
    const mass = bikeWeightKg ?? DEFAULT_RIDER_MASS_KG;
    await setAthletePowerConfig(db, athleteId, { ftpWatts: Math.round(STARTER_BIKE_WPERKG * mass), weightKg: bikeWeightKg, anchorSource: 'auto' });
  }

  // --- Swim anchor (CSS) — OPTIONAL for a phased triathlon. If the athlete
  //     isn't swimming yet, we skip it; setupTriSeason builds bike+run now and
  //     the goal tracker shows the swim leg as "not started" until they add it. ---
  let css = input.swim?.cssMetersPerSec;
  if ((css == null || css <= 0) && input.swim?.test) {
    css = cssFrom400_200(input.swim.test.t400Sec, input.swim.test.t200Sec) ?? undefined;
  }
  if (css && css > 0) {
    await setAthleteSwimConfig(db, athleteId, { cssMetersPerSec: css });
  }

  // --- DOB (for the ceiling) — set only if provided and not already stronger data. ---
  if (input.dateOfBirth && DATE_RE.test(input.dateOfBirth)) {
    await db.update(athletes).set({ dateOfBirth: input.dateOfBirth, updatedAt: new Date() }).where(eq(athletes.id, athleteId));
  }

  const legs = TRI_DISTANCE_METERS[input.distance];
  const result = await setupTriSeason(db, athleteId, {
    startDay: today,
    goalRace: {
      name: input.name?.trim() || DISTANCE_NAME[input.distance],
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
