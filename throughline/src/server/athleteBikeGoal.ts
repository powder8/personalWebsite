/**
 * Athlete-facing standalone CYCLING setup — the bike twin of athleteGoal.ts.
 * Sets the FTP anchor (+ body mass) and generates a published bike-only plan
 * toward a goal event. Self-service → autonomous coaching.
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes } from '@/db/schema';
import { setupBikeSeason, type BikeSeasonSetupResult } from '@/server/bikeSeason';
import { setAthletePowerConfig } from '@/db/powerConfig';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface BikeGoalInput {
  eventName?: string;
  date: string; // goal event day, YYYY-MM-DD
  weeklyHours: number;
  ftpWatts: number;
  weightKg?: number;
  /** Optional goal FTP to train toward — powers the honest bike goal tracker. */
  targetFtpWatts?: number;
  /** Race-time goal: distance + total climbing + a target finish time. */
  distanceMeters?: number;
  elevationGainMeters?: number;
  targetTimeSeconds?: number;
  dateOfBirth?: string;
}

export async function setupAthleteBikeGoal(
  db: DB,
  athleteId: string,
  today: string,
  input: BikeGoalInput,
): Promise<BikeSeasonSetupResult> {
  if (!input.date || !DATE_RE.test(input.date)) throw new Error('Pick your event date (YYYY-MM-DD).');
  if (input.date <= today) throw new Error('Your event date needs to be in the future.');
  if (!(input.ftpWatts > 0)) throw new Error('Enter your cycling FTP in watts.');

  await setAthletePowerConfig(db, athleteId, {
    ftpWatts: Math.round(input.ftpWatts),
    weightKg: input.weightKg && input.weightKg > 0 ? input.weightKg : undefined,
    targetFtpWatts: input.targetFtpWatts && input.targetFtpWatts > 0 ? Math.round(input.targetFtpWatts) : undefined,
    goalElevationGainMeters:
      input.elevationGainMeters && input.elevationGainMeters > 0 ? Math.round(input.elevationGainMeters) : undefined,
  });

  if (input.dateOfBirth && DATE_RE.test(input.dateOfBirth)) {
    await db.update(athletes).set({ dateOfBirth: input.dateOfBirth, updatedAt: new Date() }).where(eq(athletes.id, athleteId));
  }

  const result = await setupBikeSeason(db, athleteId, {
    startDay: today,
    goalRace: {
      name: input.eventName?.trim() || 'Cycling goal',
      date: input.date,
      distanceMeters: input.distanceMeters && input.distanceMeters > 0 ? input.distanceMeters : undefined,
      targetTimeSeconds: input.targetTimeSeconds,
    },
    weeklyHours: input.weeklyHours,
    publish: true,
  });

  await db
    .update(athletes)
    .set({ coachingMode: 'autonomous', onboardedAt: new Date(), updatedAt: new Date() })
    .where(eq(athletes.id, athleteId));

  return result;
}
