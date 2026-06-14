/**
 * PURE post-run debrief signal extraction (no DB). Turns a completed run + the
 * day's wellness into GROUNDED facts ("signals") a coach would notice — sleep,
 * how you felt, mid-run stops, terrain, pace-vs-plan (grade-adjusted) — and a
 * deterministic "what went well / focus next" narrative.
 *
 * Two uses: the deterministic narrative is the always-on fallback; the signal
 * list is the grounding handed to the LLM so its prose can't invent anything.
 */
import { assessRun, type PlannedRef } from '@/server/runFeedbackLogic';
import { secPerKmToMinPerMile } from '@/engine/plan';

export interface DebriefInput {
  planned: PlannedRef | null;
  actualMiles: number;
  actualPaceSecPerKm: number | null; // raw average
  gapSecPerKm: number | null; // grade-adjusted (when terrain mattered)
  movingSeconds: number | null;
  elapsedSeconds: number | null;
  surface: 'road' | 'trail' | null;
  climbFeet: number;
  sleepHours: number | null;
  sleepNormHours: number | null; // athlete's typical
  energy: number | null; // 0–10
  soreness: number | null; // 0–10
}

export type SignalPolarity = 'positive' | 'caution' | 'context';
export interface RunSignal {
  key: 'showed_up' | 'sleep' | 'feel' | 'stops' | 'terrain' | 'pace' | 'distance';
  polarity: SignalPolarity;
  fact: string; // a grounded statement (no invention)
}

export interface RunDebrief {
  headline: string;
  signals: RunSignal[];
  wentWell: string[];
  focusNext: string[];
}

const pm = (s: number) => `${secPerKmToMinPerMile(s)}/mi`;
const QUALITY = new Set(['threshold', 'tempo', 'intervals', 'interval', 'marathon', 'race']);

export function buildDebrief(input: DebriefInput): RunDebrief {
  const signals: RunSignal[] = [];
  const wentWell: string[] = [];
  const focusNext: string[] = [];

  const adverseSleep = input.sleepHours != null && input.sleepHours < (input.sleepNormHours != null ? input.sleepNormHours - 1.5 : 6);
  const lowEnergy = input.energy != null && input.energy <= 4;
  const sore = input.soreness != null && input.soreness >= 6;
  const adverse = adverseSleep || lowEnergy || sore;

  // --- Wellness context ---
  if (input.sleepHours != null && adverseSleep) {
    signals.push({
      key: 'sleep',
      polarity: 'context',
      fact: `Slept ${input.sleepHours.toFixed(1)}h${input.sleepNormHours ? ` (below your ~${input.sleepNormHours.toFixed(1)}h norm)` : ' (short)'}.`,
    });
  }
  if (lowEnergy) signals.push({ key: 'feel', polarity: 'context', fact: `Energy was low going in (${input.energy}/10).` });
  if (sore) signals.push({ key: 'feel', polarity: 'context', fact: `Soreness was elevated (${input.soreness}/10).` });

  // --- Showing up despite a rough day is the headline win ---
  if (adverse && input.actualMiles > 0) {
    signals.push({ key: 'showed_up', polarity: 'positive', fact: 'Got the run done on a day the body wasn’t at its best.' });
    wentWell.push('You got out the door on a rough day — poor sleep and low energy make that the hardest part, and you did it.');
  }

  // --- Mid-run stops (elapsed − moving) ---
  if (input.movingSeconds != null && input.elapsedSeconds != null) {
    const stopped = input.elapsedSeconds - input.movingSeconds;
    if (stopped >= 90) {
      const min = Math.round(stopped / 60);
      signals.push({ key: 'stops', polarity: 'positive', fact: `Paused ~${min} min mid-run (moving vs elapsed time).` });
      wentWell.push(`You took ~${min} min of breaks — listening to your body and walking when you need to is smart, not a setback.`);
    }
  }

  // --- Terrain: trail/hills, and GAP vs raw ---
  const gapFaster = input.gapSecPerKm != null && input.actualPaceSecPerKm != null && input.gapSecPerKm < input.actualPaceSecPerKm - 6;
  if (gapFaster) {
    signals.push({
      key: 'terrain',
      polarity: 'positive',
      fact: `On ${input.surface === 'trail' ? 'the trails' : 'the hills'}, effort beat the clock — grade-adjusted ${pm(input.gapSecPerKm!)} vs ${pm(input.actualPaceSecPerKm!)} actual.`,
    });
    wentWell.push(
      `Don’t be fooled by the raw pace — over ${input.climbFeet}+ ft${input.surface === 'trail' ? ' of trail' : ''}, your grade-adjusted effort was ${pm(input.gapSecPerKm!)}. That’s the honest read, and it was strong.`,
    );
  } else if (input.surface === 'trail' || input.climbFeet >= 200) {
    signals.push({
      key: 'terrain',
      polarity: 'context',
      fact: `${input.climbFeet} ft of climb${input.surface === 'trail' ? ' on trail' : ''} — softer ground and hills cost pace.`,
    });
  }

  // --- Pace vs plan (judged on grade-adjusted effort) ---
  const effortPace = input.gapSecPerKm ?? input.actualPaceSecPerKm;
  const verdict = assessRun({ actualMiles: input.actualMiles, actualPaceSecPerKm: effortPace, planned: input.planned });
  const isQuality = input.planned ? QUALITY.has(input.planned.sessionType) : false;
  if (verdict.positive && (verdict.verdict === 'nailed' || verdict.verdict === 'solid')) {
    signals.push({ key: 'pace', polarity: 'positive', fact: verdict.headline });
    wentWell.push(verdict.detail);
  } else if (!verdict.positive) {
    signals.push({ key: 'pace', polarity: 'caution', fact: verdict.headline });
    focusNext.push(verdict.detail);
  } else if (verdict.verdict === 'short') {
    signals.push({ key: 'distance', polarity: 'context', fact: verdict.headline });
  }

  // --- Focus-next guidance, shaped by context ---
  if (adverse) {
    focusNext.push(
      'On low sleep or energy, treat the prescribed paces as ceilings, not targets — run by effort and it’s fine to cut a session short. The plan adapts; consistency over weeks is what counts.',
    );
  }
  if (verdict.verdict === 'too_fast_easy') {
    focusNext.push('Even adjusted for terrain, this drifted quick for an easy day — especially worth reining in when you’re under-recovered.');
  }
  if (isQuality && verdict.verdict === 'too_hard') {
    focusNext.push('Strong, but leave a little in the tank on quality days — racing the workout steals from race day.');
  }
  if (focusNext.length === 0) {
    focusNext.push('Nothing to change — bank it and recover well. Keep stacking days like this.');
  }
  if (wentWell.length === 0) {
    wentWell.push(`You covered ${input.actualMiles.toFixed(1)} mi and got it logged — showing up is the habit that builds everything else.`);
  }

  const headline = adverse
    ? 'Tough day, good decision to run'
    : verdict.positive
      ? 'Solid session'
      : 'Done — one thing to tighten up';

  return { headline, signals, wentWell, focusNext };
}
