/**
 * Coordinated run + bike season — the "one view of time" resizer.
 *
 * An athlete can hold an independent run goal and an independent bike goal at
 * once (each set up on its own; see season.ts / bikeSeason.ts, discipline-scoped
 * so they coexist). The risk is two full-time plans stacked into an impossible
 * week. This takes the athlete's ONE realistic weekly-hours budget, splits it
 * across the active goals by training demand ({@link allocateDualSportHours}),
 * and REBUILDS each existing plan sized to its share — the run plan from its
 * hours→miles, the bike plan from its hours→TSS — preserving each goal race and
 * the athlete's fitness anchors (fitness is omitted, so setupSeason keeps them).
 *
 * Idempotent and discipline-scoped: rebuilding one sport never touches the other.
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { races, athletes } from '@/db/schema';
import { allocateDualSportHours, runWeeklyMilesFromHours, isPaceZones, type DualDiscipline } from '@/engine/plan';
import { getAthleteZones } from '@/db/paceConfig';
import { setupSeason, type SeasonRaceInput } from './season';
import { setupBikeSeason } from './bikeSeason';

/** Start-of-ramp fraction of peak weekly volume (matches season/bike setups). */
const START_FRACTION = 0.55;

export interface DualSeasonInput {
  /** The athlete's realistic TOTAL weekly training hours — the shared budget. */
  weeklyHours: number;
  /** The A-goal, if the athlete named one — it gets the demand boost. */
  priority?: DualDiscipline;
  publish?: boolean;
}

export interface DualSeasonResult {
  disciplines: DualDiscipline[];
  hours: Partial<Record<DualDiscipline, number>>;
  notes: string[];
}

/** Map a stored race row back to the setup layer's SeasonRaceInput. */
function toRaceInput(r: typeof races.$inferSelect): SeasonRaceInput {
  return {
    name: r.name,
    date: r.date,
    distanceLabel: r.distanceLabel ?? undefined,
    distanceMeters: r.distanceMeters ?? undefined,
    priority: r.priority as SeasonRaceInput['priority'],
    purpose: r.purpose ?? undefined,
    goalType: (r.goalType as SeasonRaceInput['goalType']) ?? undefined,
    targetTimeSeconds: r.targetTimeSeconds ?? undefined,
    targetPaceSecPerKm: r.targetPaceSecPerKm ?? undefined,
  };
}

/**
 * Split the shared weekly-hours budget across the athlete's live run/bike goals
 * and rebuild each plan to fit. Returns which sports were resized and their
 * hours. No-op sports (no goal) are skipped.
 */
export async function resplitDualSeason(
  db: DB,
  athleteId: string,
  today: string,
  input: DualSeasonInput,
): Promise<DualSeasonResult> {
  const rows = await db.select().from(races).where(eq(races.athleteId, athleteId));
  const runGoal = rows.find((r) => r.discipline === 'run' && r.priority === 'goal' && r.date >= today);
  const bikeGoal = rows.find((r) => r.discipline === 'bike' && r.priority === 'goal' && r.date >= today);

  const active: DualDiscipline[] = [];
  if (runGoal) active.push('run');
  if (bikeGoal) active.push('bike');
  if (active.length === 0) return { disciplines: [], hours: {}, notes: ['No live run or bike goal to coordinate.'] };

  const allocation = allocateDualSportHours({ weeklyHours: input.weeklyHours, disciplines: active, priority: input.priority });
  const hours: Partial<Record<DualDiscipline, number>> = {};

  // Persist the shared budget so the portal control shows the current value and
  // a future goal change can re-split against it.
  await db
    .update(athletes)
    .set({ weeklyHoursBudget: input.weeklyHours, updatedAt: new Date() })
    .where(eq(athletes.id, athleteId));

  // BIKE: rebuild from its hours share (hours→TSS lives in setupBikeSeason).
  if (bikeGoal) {
    const bikeHours = allocation.budgets.bike!.hours;
    hours.bike = bikeHours;
    await setupBikeSeason(db, athleteId, {
      startDay: today,
      goalRace: {
        name: bikeGoal.name,
        date: bikeGoal.date,
        distanceLabel: bikeGoal.distanceLabel ?? undefined,
        distanceMeters: bikeGoal.distanceMeters ?? undefined,
        targetTimeSeconds: bikeGoal.targetTimeSeconds ?? undefined,
      },
      weeklyHours: bikeHours,
      publish: input.publish,
    });
  }

  // RUN: rebuild from its hours share, converted to weekly miles via the run's
  // own zones (the run periodizer's currency). Keeps the existing anchor + races.
  if (runGoal) {
    const runHours = allocation.budgets.run!.hours;
    hours.run = runHours;
    const zones = await getAthleteZones(db, athleteId);
    if (!zones || !isPaceZones(zones)) {
      throw new Error('Run goal needs a pace/VDOT anchor before it can be coordinated.');
    }
    const peakMiles = runWeeklyMilesFromHours(runHours, zones);
    const keyRaces = rows
      .filter((r) => r.discipline === 'run' && r.priority !== 'goal' && r.date >= today)
      .map(toRaceInput);
    await setupSeason(db, athleteId, {
      startDay: today,
      goalRace: toRaceInput(runGoal),
      keyRaces,
      // fitness omitted → setupSeason keeps the athlete's existing run anchor.
      startVolumeMiles: peakMiles * START_FRACTION,
      peakVolumeMiles: peakMiles,
      publish: input.publish,
    });
  }

  return { disciplines: active, hours, notes: allocation.notes };
}
