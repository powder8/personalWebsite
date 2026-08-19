/**
 * Standalone CYCLING season setup — the bike twin of season.ts (running).
 * Cycling is a first-class discipline, not only a triathlon leg: a cyclist sets
 * an FTP anchor + a weekly-hours budget + a goal event, and gets a periodized,
 * published bike-only plan through the SAME generate/periodize pipeline the tri
 * bike leg uses (power zones, TSS→duration@power, COACH_BIKE_TEMPLATE_SET).
 *
 * Idempotent: re-running replaces the athlete's races + plan. `db` is passed in
 * so this works against Neon, local PGlite, and tests.
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes, races, plans } from '@/db/schema';
import { generatePlan, tssFromHours, TYPICAL_WEEKLY_IF, COACH_BIKE_TEMPLATE_SET } from '@/engine/plan';
import { persistPlanDraft } from '@/db/plans';
import { getAthletePowerZones } from '@/db/powerConfig';

/** Start-of-ramp fraction of peak weekly TSS the periodizer ramps up from (matches triPlan). */
const START_FRACTION = 0.55;

export interface BikeSeasonSetupInput {
  startDay: string; // build start (caller passes "today")
  goalRace: { name: string; date: string; distanceLabel?: string; distanceMeters?: number; targetTimeSeconds?: number };
  /** Realistic weekly cycling hours — priced into a weekly TSS budget. */
  weeklyHours: number;
  publish?: boolean;
}

export interface BikeSeasonSetupResult {
  weeks: number;
  peakTss: number;
}

export async function setupBikeSeason(
  db: DB,
  athleteId: string,
  input: BikeSeasonSetupInput,
): Promise<BikeSeasonSetupResult> {
  const zones = await getAthletePowerZones(db, athleteId);
  if (!zones) throw new Error('No cycling fitness anchor yet, set your FTP first.');

  const peakTss = Math.round(tssFromHours(input.weeklyHours, TYPICAL_WEEKLY_IF.bike));

  await db
    .update(athletes)
    .set({ goalRace: input.goalRace.name, goalRaceDate: input.goalRace.date, updatedAt: new Date() })
    .where(eq(athletes.id, athleteId));

  await db.delete(races).where(eq(races.athleteId, athleteId));
  await db.insert(races).values({
    athleteId,
    name: input.goalRace.name,
    date: input.goalRace.date,
    distanceLabel: input.goalRace.distanceLabel ?? 'Bike',
    distanceMeters: input.goalRace.distanceMeters ?? null,
    priority: 'goal',
    purpose: 'goal',
    goalType: input.goalRace.targetTimeSeconds != null ? 'time' : 'none',
    targetTimeSeconds: input.goalRace.targetTimeSeconds ?? null,
  });

  await db.delete(plans).where(eq(plans.athleteId, athleteId)); // cascades planned_sessions
  const weeks = generatePlan(
    {
      startDay: input.startDay,
      goalRaceDay: input.goalRace.date,
      startVolumeMiles: peakTss * START_FRACTION, // 'miles' param carries weekly TSS on the bike arm
      peakVolumeMiles: peakTss,
      discipline: 'bike',
    },
    zones,
    COACH_BIKE_TEMPLATE_SET,
  );
  await persistPlanDraft(
    db,
    athleteId,
    weeks,
    zones,
    { setupAt: input.startDay, discipline: 'bike', weeklyHours: input.weeklyHours },
    { status: input.publish ? 'published' : 'draft' },
  );

  return { weeks: weeks.length, peakTss };
}
