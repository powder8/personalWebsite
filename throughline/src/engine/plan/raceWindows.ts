/**
 * Race-window advisor: given a goal race, recommend WHEN (and what distance) to
 * look for tune-up races on the path to it. Deterministic, grounded in standard
 * periodization:
 *   - nothing all-out right before the goal (taper);
 *   - a short sharpener ~2–3 weeks out;
 *   - a goal-specificity tune-up ~4–6 weeks out (shorter than the goal);
 *   - a mid-build fitness check ~7–11 weeks out;
 *   - an optional early opener if the build is long enough.
 *
 * Output is advisory date ranges the coach (or the athlete-facing flow) fills
 * with actual races.
 */
import type { TrainingPhase, PaceZones, PaceRange, ZoneKey } from './types';
import { addDays, diffDays } from '../dates';
import { paceRangeLabel } from './zones';

export type RaceWindowKind = 'opener' | 'fitness_check' | 'specificity_tuneup' | 'final_sharpener';

export interface GoalRaceInput {
  date: string; // 'YYYY-MM-DD'
  distanceMeters?: number | null;
  distanceLabel?: string | null;
}

export interface RaceWindow {
  kind: RaceWindowKind;
  label: string;
  fromDate: string; // earlier bound
  toDate: string; // later bound (closer to goal)
  minWeeksOut: number;
  maxWeeksOut: number;
  suggestedDistances: string[];
  primaryDistance: string; // the headline recommended distance
  /** Target race pace for the primary distance, from the athlete's own zones. */
  targetPace: PaceRange | null;
  targetPaceLabel: string | null;
  /** How to run it (effort/intent). */
  effortNote: string;
  /** What the course should look like. */
  courseProfile: string;
  priority: 'tune_up' | 'training';
  phase: TrainingPhase;
  rationale: string;
}

type GoalClass = 'marathon' | 'half' | 'tenk_or_shorter';

function classifyGoal(goal: GoalRaceInput): GoalClass {
  const label = (goal.distanceLabel ?? '').toLowerCase();
  if (label.includes('marathon') && !label.includes('half')) return 'marathon';
  if (label.includes('half')) return 'half';
  if (goal.distanceMeters != null) {
    if (goal.distanceMeters >= 35000) return 'marathon';
    if (goal.distanceMeters >= 18000) return 'half';
  }
  if (label.includes('10') || label.includes('5')) return 'tenk_or_shorter';
  // default to half-ish if unknown
  return 'half';
}

/** Suggested tune-up distances per goal class and window kind. */
const DISTANCES: Record<GoalClass, Record<RaceWindowKind, string[]>> = {
  marathon: {
    opener: ['5K', '10K'],
    fitness_check: ['10K', '15K'],
    specificity_tuneup: ['Half'],
    final_sharpener: ['5K', '10K'],
  },
  half: {
    opener: ['5K'],
    fitness_check: ['10K'],
    specificity_tuneup: ['10K', '15K'],
    final_sharpener: ['5K'],
  },
  tenk_or_shorter: {
    opener: ['Mile', '5K'],
    fitness_check: ['5K'],
    specificity_tuneup: ['5K'],
    final_sharpener: ['Mile', '3K'],
  },
};

interface WindowTemplate {
  kind: RaceWindowKind;
  label: string;
  minWeeksOut: number;
  maxWeeksOut: number;
  priority: 'tune_up' | 'training';
  phase: TrainingPhase;
  rationale: string;
  effortNote: string;
  courseProfile: string;
}

const TEMPLATES: WindowTemplate[] = [
  {
    kind: 'final_sharpener',
    label: 'Final sharpener',
    minWeeksOut: 2,
    maxWeeksOut: 3,
    priority: 'tune_up',
    phase: 'taper',
    rationale: 'Short, sharp effort to prime race legs — far enough out to recover fully.',
    effortNote: 'Race controlled and short — sharpen the legs, this is not a max effort.',
    courseProfile: 'Flat and fast; a low-key local race is ideal.',
  },
  {
    kind: 'specificity_tuneup',
    label: 'Goal-specificity tune-up',
    minWeeksOut: 4,
    maxWeeksOut: 6,
    priority: 'tune_up',
    phase: 'peak',
    rationale: 'A longer race near goal effort to rehearse pacing and confirm fitness at peak.',
    effortNote: 'Near goal effort — rehearse goal-race pacing, fueling, and kit.',
    courseProfile: 'Flat and fast, and as similar to the goal course as possible — a dress rehearsal.',
  },
  {
    kind: 'fitness_check',
    label: 'Mid-build fitness check',
    minWeeksOut: 7,
    maxWeeksOut: 11,
    priority: 'tune_up',
    phase: 'build',
    rationale: 'Gauge progress mid-build and practice racing without disrupting the block.',
    effortNote: 'Honest race effort to gauge fitness — then back to the build.',
    courseProfile: 'Any profile; rolling is fine — don’t over-prioritize a fast course.',
  },
  {
    kind: 'opener',
    label: 'Early opener (optional)',
    minWeeksOut: 12,
    maxWeeksOut: 18,
    priority: 'training',
    phase: 'base',
    rationale: 'Low-stakes opener to shake off rust; run as a workout, not all-out.',
    effortNote: 'Run as a workout, not all-out — shake off the rust.',
    courseProfile: 'Any course; convenience over course quality.',
  },
];

/** Which training zone best approximates race pace for a given distance. */
function racePaceZoneForDistance(distanceLabel: string): ZoneKey {
  const d = distanceLabel.toLowerCase();
  if (d === 'mile' || d === '3k') return 'rep';
  if (d === '5k' || d === '10k') return 'interval';
  if (d === '15k' || d === 'half') return 'threshold';
  if (d.includes('marathon')) return 'marathon';
  return 'threshold';
}

export function suggestRaceWindows(
  goal: GoalRaceInput,
  startDay: string,
  zones?: PaceZones,
): RaceWindow[] {
  const weeksToGoal = Math.floor(diffDays(goal.date, startDay) / 7);
  if (weeksToGoal < 3) return []; // too close to slot a tune-up
  const cls = classifyGoal(goal);

  return TEMPLATES.filter((t) => weeksToGoal >= t.minWeeksOut + 1) // window must fit in the build
    .map((t) => {
      // Clamp the far bound to the build start.
      const maxOut = Math.min(t.maxWeeksOut, weeksToGoal - 1);
      const distances = DISTANCES[cls][t.kind];
      const primaryDistance = distances[0];
      const paceZone = racePaceZoneForDistance(primaryDistance);
      const targetPace = zones ? zones.zones[paceZone] : null;
      return {
        kind: t.kind,
        label: t.label,
        fromDate: addDays(goal.date, -maxOut * 7),
        toDate: addDays(goal.date, -t.minWeeksOut * 7),
        minWeeksOut: t.minWeeksOut,
        maxWeeksOut: maxOut,
        suggestedDistances: distances,
        primaryDistance,
        targetPace,
        targetPaceLabel: targetPace ? paceRangeLabel(targetPace) : null,
        effortNote: t.effortNote,
        courseProfile: t.courseProfile,
        priority: t.priority,
        phase: t.phase,
        rationale: t.rationale,
      } satisfies RaceWindow;
    })
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate));
}

/** Mark whether a scheduled race already falls inside each window. */
export function annotateWindows<T extends { date: string }>(
  windows: RaceWindow[],
  scheduledRaces: T[],
): (RaceWindow & { filledBy: T | null })[] {
  return windows.map((w) => ({
    ...w,
    filledBy: scheduledRaces.find((r) => r.date >= w.fromDate && r.date <= w.toDate) ?? null,
  }));
}
