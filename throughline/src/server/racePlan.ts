/**
 * Athlete-facing race plan: the goal race, a target-time window grounded in
 * current fitness (VDOT), and suggested tune-up race windows (with dates,
 * distances, effort intent, and course/terrain guidance) on the path to it.
 * Surfaces what the engine already knows (raceWindows) — Runna-style
 * "estimated times" + warm-up race planning, in one read model.
 */
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { races } from '@/db/schema';
import {
  suggestRaceWindows,
  annotateWindows,
  predictRaceTimeSeconds,
  type RaceWindow,
} from '@/engine/plan';
import { getAthleteVdot, getAthleteZones } from '@/db/paceConfig';

export interface RacePlan {
  goal: {
    name: string;
    date: string;
    distanceLabel: string | null;
    distanceMeters: number | null;
    targetTimeSeconds: number | null; // athlete's own stated target, if any
  };
  /**
   * Fitness-grounded target window for the goal distance:
   * solid = what current fitness predicts today; stretch = with a good block
   * of training behind you (~+1.5 VDOT, a typical focused-build gain).
   */
  target: { solidSeconds: number; stretchSeconds: number; vdot: number } | null;
  /** Tune-up windows (date ranges) with what's already scheduled in each. */
  windows: (RaceWindow & { filledBy: { name: string; date: string } | null })[];
  /** Course/terrain guidance for the goal race itself. */
  goalCourseNote: string;
}

const STRETCH_VDOT_GAIN = 1.5;

export async function getRacePlan(db: DB, athleteId: string, today: string): Promise<RacePlan | null> {
  const raceList = await db.select().from(races).where(eq(races.athleteId, athleteId));
  const goal = raceList.find((r) => r.priority === 'goal');
  if (!goal || goal.date < today) return null;

  const vdot = await getAthleteVdot(db, athleteId);
  const zones = (await getAthleteZones(db, athleteId)) ?? undefined;

  const target =
    vdot != null && goal.distanceMeters
      ? {
          vdot: Math.round(vdot * 10) / 10,
          solidSeconds: predictRaceTimeSeconds(vdot, goal.distanceMeters),
          stretchSeconds: predictRaceTimeSeconds(vdot + STRETCH_VDOT_GAIN, goal.distanceMeters),
        }
      : null;

  const windows = annotateWindows(
    suggestRaceWindows(
      { date: goal.date, distanceMeters: goal.distanceMeters, distanceLabel: goal.distanceLabel },
      today,
      zones,
    ),
    raceList
      .filter((r) => r.id !== goal.id)
      .map((r) => ({ name: r.name, date: r.date })),
  );

  return {
    goal: {
      name: goal.name,
      date: goal.date,
      distanceLabel: goal.distanceLabel,
      distanceMeters: goal.distanceMeters,
      targetTimeSeconds: goal.targetTimeSeconds,
    },
    target,
    windows,
    goalCourseNote:
      'Chasing a time? Course choice matters: pick a flat, fast course (and do your key timed sessions on flat ground too — save hills for easy and strength days).',
  };
}
