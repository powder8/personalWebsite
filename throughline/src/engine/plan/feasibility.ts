/**
 * Goal feasibility — is the athlete's stated goal reachable by race day, given
 * where they are now and how much time is left? The race plan already shows a
 * target window from CURRENT fitness; this answers the different question a
 * coach asks: "can we actually close the gap to the GOAL in the weeks we have?"
 *
 * Improvement model (pure, deterministic, tunable): fitness gains diminish as
 * VDOT rises (a VDOT-65 runner improves far slower than a VDOT-48 one), the
 * last few weeks are taper (no fitness added), and a single season has a soft
 * ceiling. Numbers are coaching heuristics aligned with Daniels-style re-testing
 * (~1 VDOT every few weeks for trained runners), not a physiological claim.
 */
import { predictRaceTimeSeconds } from './vdot';

export type FeasibilityVerdict = 'ahead' | 'on_track' | 'stretch' | 'unrealistic';

export interface GoalFeasibility {
  verdict: FeasibilityVerdict;
  currentVdot: number;
  goalVdot: number;
  weeksToRace: number;
  trainableWeeks: number; // weeks of real training before taper
  typicalWeeklyGain: number; // VDOT/wk a solid block yields at this fitness
  achievableGain: number; // realistic total VDOT gain in the time left
  projectedVdot: number; // realistic race-day fitness
  projectedTimeSeconds: number; // realistic race-day time for the goal distance
  requiredWeeklyGain: number; // VDOT/wk the goal demands
  weeksNeededForGoal: number | null; // weeks a normal build needs to reach the goal
  headline: string;
  note: string;
}

const SEASON_GAIN_CAP = 8; // most a single season realistically adds (VDOT)

/** Typical VDOT gain per focused training week — diminishes with fitness. */
export function typicalWeeklyVdotGain(vdot: number): number {
  // ~0.40/wk around VDOT 45, ~0.15/wk around VDOT 65.
  return Math.max(0.12, Math.min(0.45, 0.5 - (vdot - 40) / 100));
}

function taperWeeksFor(distanceMeters: number): number {
  if (distanceMeters >= 35000) return 3; // marathon
  if (distanceMeters >= 18000) return 2; // half
  return 1;
}

function fmt(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export interface GoalFeasibilityInput {
  currentVdot: number;
  goalVdot: number;
  weeksToRace: number;
  goalDistanceMeters: number;
  goalLabel?: string | null; // e.g. "2:38 marathon"
}

export function assessGoalFeasibility(input: GoalFeasibilityInput): GoalFeasibility {
  const { currentVdot, goalVdot, weeksToRace, goalDistanceMeters } = input;
  const taper = taperWeeksFor(goalDistanceMeters);
  const trainableWeeks = Math.max(0, weeksToRace - taper);
  const typicalWeeklyGain = typicalWeeklyVdotGain(currentVdot);
  const achievableGain = Math.min(SEASON_GAIN_CAP, typicalWeeklyGain * trainableWeeks);
  const optimisticGain = achievableGain * 1.3; // everything clicks

  const projectedVdot = Math.round((currentVdot + achievableGain) * 10) / 10;
  const projectedTimeSeconds = predictRaceTimeSeconds(projectedVdot, goalDistanceMeters);

  const gap = goalVdot - currentVdot;
  const requiredWeeklyGain = trainableWeeks > 0 ? Math.round((gap / trainableWeeks) * 100) / 100 : Infinity;
  const weeksNeededForGoal = gap > 0 ? Math.ceil(gap / typicalWeeklyGain) + taper : 0;

  const goalName = input.goalLabel ?? 'your goal';
  const projLabel = fmt(projectedTimeSeconds);

  let verdict: FeasibilityVerdict;
  let headline: string;
  let note: string;

  if (gap <= 0) {
    verdict = 'ahead';
    headline = 'You’re already at goal fitness';
    note = `Your current fitness already meets ${goalName}. The plan keeps you sharp and lets you target something a touch faster if you want.`;
  } else if (gap <= achievableGain + 0.5) {
    verdict = 'on_track';
    headline = 'Your goal is on track';
    note = `${goalName} needs about +${gap.toFixed(1)} VDOT, and a solid ${trainableWeeks}-week build at your level typically adds ~${achievableGain.toFixed(1)}. Right in range — stay consistent and it’s yours.`;
  } else if (gap <= optimisticGain + 1) {
    verdict = 'stretch';
    headline = 'A real stretch — reachable if it all clicks';
    note = `${goalName} asks for +${gap.toFixed(1)} VDOT in ${trainableWeeks} trainable weeks (~${requiredWeeklyGain}/wk). A strong block typically adds ~${achievableGain.toFixed(1)} (~${typicalWeeklyGain.toFixed(2)}/wk), so it’s the ceiling, not the expectation. Realistic race-day target: ~${projLabel}. Chase the goal, but treat ${projLabel} as success too.`;
  } else {
    verdict = 'unrealistic';
    headline = 'Not this race — let’s aim honestly';
    note = `${goalName} needs +${gap.toFixed(1)} VDOT, but ${trainableWeeks} weeks realistically adds ~${achievableGain.toFixed(1)} at your level. A normal build to that goal takes ~${weeksNeededForGoal} weeks. For this race, ~${projLabel} is a strong, realistic target — then we set the bigger goal for a later date.`;
  }

  return {
    verdict,
    currentVdot: Math.round(currentVdot * 10) / 10,
    goalVdot: Math.round(goalVdot * 10) / 10,
    weeksToRace,
    trainableWeeks,
    typicalWeeklyGain: Math.round(typicalWeeklyGain * 100) / 100,
    achievableGain: Math.round(achievableGain * 10) / 10,
    projectedVdot,
    projectedTimeSeconds,
    requiredWeeklyGain,
    weeksNeededForGoal,
    headline,
    note,
  };
}
