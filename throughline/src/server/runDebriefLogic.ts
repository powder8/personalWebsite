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
import { detectIntervals, type IntervalResult, type LapSeg } from '@/engine/plan/intervalDetection';

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
  // The athlete's own post-run read — what the sensors can't see. Takes
  // precedence when present (they were there; the data wasn't).
  reportedFeel?: 'strong' | 'fine' | 'rough' | null;
  reportedUnwell?: boolean;
  reportedBreaks?: boolean;
  reportedSurface?: 'road' | 'trail' | 'track' | 'treadmill' | null;
  // Same-day consolidation: when a session was logged as several runs
  // (warm-up + race + cool-down), how many and the day's total distance. The
  // assessed run is the primary effort; this gives the day its proper context.
  dayRunCount?: number;
  dayTotalMiles?: number;
  // Watch laps — present when the athlete pressed the lap button. Used to
  // detect interval sessions so the debrief speaks to reps, not avg pace.
  laps?: LapSeg[] | null;
}

export type SignalPolarity = 'positive' | 'caution' | 'context';
export interface RunSignal {
  key: 'showed_up' | 'sleep' | 'feel' | 'stops' | 'terrain' | 'pace' | 'distance' | 'session' | 'intervals';
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

/** Round to nearest N meters for display (e.g. 197m → 200m). */
function roundDist(m: number, to = 25): number {
  return Math.round(m / to) * to;
}

export function buildDebrief(input: DebriefInput): RunDebrief {
  // Detect interval session from lap data first. If confirmed, use a separate
  // evaluation path — the whole-file avg pace is meaningless for rep workouts.
  const iv = detectIntervals(input.laps);
  if (iv) return buildIntervalDebrief(input, iv);

  const signals: RunSignal[] = [];
  const wentWell: string[] = [];
  const focusNext: string[] = [];

  // Multi-run day: this was one session split across several uploads.
  const dayRuns = input.dayRunCount ?? 1;
  if (dayRuns > 1) {
    const total = input.dayTotalMiles != null ? `${input.dayTotalMiles} mi total` : 'across the day';
    signals.push({ key: 'session', polarity: 'context', fact: `${dayRuns} runs that day (${total}) — judged on your main effort.` });
    wentWell.push(`You logged ${dayRuns} runs in that session (${total}) — bookending the main effort with a warm-up and cool-down is exactly how to set up a good session.`);
  }

  const adverseSleep = input.sleepHours != null && input.sleepHours < (input.sleepNormHours != null ? input.sleepNormHours - 1.5 : 6);
  const lowEnergy = input.energy != null && input.energy <= 4;
  const sore = input.soreness != null && input.soreness >= 6;
  // The athlete's own report takes precedence over (or adds to) the sensors.
  const feltRough = input.reportedUnwell === true || input.reportedFeel === 'rough';
  const adverse = adverseSleep || lowEnergy || sore || feltRough;
  const surface = input.reportedSurface ?? input.surface; // their word beats sport_type

  // --- Wellness context (sensors + their own read) ---
  if (input.reportedUnwell) {
    signals.push({ key: 'feel', polarity: 'context', fact: 'You said you weren’t feeling well.' });
  } else if (input.reportedFeel === 'rough') {
    signals.push({ key: 'feel', polarity: 'context', fact: 'You said it felt rough.' });
  } else if (input.reportedFeel === 'strong') {
    signals.push({ key: 'feel', polarity: 'positive', fact: 'You said it felt strong.' });
  }
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
    wentWell.push('You got out the door on a rough day — when sleep, energy, or how you feel is off, that’s the hardest part, and you did it.');
  } else if (input.reportedFeel === 'strong' && input.actualMiles > 0) {
    wentWell.push('You felt strong out there — bank that; the days everything clicks are the ones to build on.');
  }

  // --- Mid-run stops: sensor (elapsed − moving) OR the athlete telling us ---
  const stoppedSec = input.movingSeconds != null && input.elapsedSeconds != null ? input.elapsedSeconds - input.movingSeconds : 0;
  if (stoppedSec >= 90) {
    const min = Math.round(stoppedSec / 60);
    signals.push({ key: 'stops', polarity: 'positive', fact: `Paused ~${min} min mid-run (moving vs elapsed time).` });
    wentWell.push(`You took ~${min} min of breaks — listening to your body and walking when you need to is smart, not a setback.`);
  } else if (input.reportedBreaks) {
    signals.push({ key: 'stops', polarity: 'positive', fact: 'You noted you took a few breaks mid-run.' });
    wentWell.push('Taking breaks when your body asks is a strength, not a failure — better a paused run than a skipped one.');
  }

  // --- Terrain: trail/hills, and GAP vs raw ---
  const isTrail = surface === 'trail';
  const gapFaster = input.gapSecPerKm != null && input.actualPaceSecPerKm != null && input.gapSecPerKm < input.actualPaceSecPerKm - 6;
  if (gapFaster) {
    signals.push({
      key: 'terrain',
      polarity: 'positive',
      fact: `On ${isTrail ? 'the trails' : 'the hills'}, effort beat the clock — grade-adjusted ${pm(input.gapSecPerKm!)} vs ${pm(input.actualPaceSecPerKm!)} actual.`,
    });
    wentWell.push(
      `Don’t be fooled by the raw pace — over ${input.climbFeet}+ ft${isTrail ? ' of trail' : ''}, your grade-adjusted effort was ${pm(input.gapSecPerKm!)}. That’s the honest read, and it was strong.`,
    );
  } else if (isTrail || input.climbFeet >= 200) {
    signals.push({
      key: 'terrain',
      polarity: 'context',
      fact: `${input.climbFeet} ft of climb${isTrail ? ` on ${surface}` : ''} — softer ground and hills cost pace, so judge it by effort.`,
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

/** Separate evaluation path for interval/rep sessions. */
function buildIntervalDebrief(input: DebriefInput, iv: IntervalResult): RunDebrief {
  const signals: RunSignal[] = [];
  const wentWell: string[] = [];
  const focusNext: string[] = [];

  const repDist = roundDist(iv.repAvgDistMeters);
  const effortPace = pm(iv.repAvgPaceSecPerKm);

  signals.push({
    key: 'intervals',
    polarity: 'positive',
    fact: `Track intervals: ${iv.repCount} rep${iv.repCount > 1 ? 's' : ''} × ~${repDist}m · avg effort ${effortPace}${iv.recoveryAvgPaceSecPerKm ? ` · recovery ~${pm(iv.recoveryAvgPaceSecPerKm)}` : ''}`,
  });
  wentWell.push(
    `You ran ${iv.repCount} rep${iv.repCount > 1 ? 's' : ''} at ${effortPace} average — that's genuine speed work, and speed work is where top-end fitness is built.`,
  );
  focusNext.push(
    "Intervals are high-cost: make the day after genuinely easy. If soreness or fatigue lingers into the second day, that's normal — don't rush back to quality work.",
  );

  // Wellness context (same checks as continuous runs)
  const adverseSleep = input.sleepHours != null && input.sleepHours < (input.sleepNormHours != null ? input.sleepNormHours - 1.5 : 6);
  const lowEnergy = input.energy != null && input.energy <= 4;
  const sore = input.soreness != null && input.soreness >= 6;
  const feltRough = input.reportedUnwell === true || input.reportedFeel === 'rough';
  const adverse = adverseSleep || lowEnergy || sore || feltRough;

  if (input.reportedUnwell) {
    signals.push({ key: 'feel', polarity: 'context', fact: "You said you weren't feeling well." });
  } else if (input.reportedFeel === 'rough') {
    signals.push({ key: 'feel', polarity: 'context', fact: 'You said it felt rough.' });
  } else if (input.reportedFeel === 'strong') {
    signals.push({ key: 'feel', polarity: 'positive', fact: 'You said it felt strong.' });
  }
  if (adverseSleep) {
    signals.push({ key: 'sleep', polarity: 'context', fact: `Slept ${input.sleepHours!.toFixed(1)}h${input.sleepNormHours ? ` (below your ~${input.sleepNormHours.toFixed(1)}h norm)` : ' (short)'}.` });
  }
  if (lowEnergy) signals.push({ key: 'feel', polarity: 'context', fact: `Energy was low going in (${input.energy}/10).` });
  if (sore) signals.push({ key: 'feel', polarity: 'context', fact: `Soreness was elevated (${input.soreness}/10).` });

  if (adverse) {
    wentWell.push('Running intervals on a less-than-fresh day takes grit — the adaptation still counts.');
    focusNext.push('With limited sleep or energy, recovery from intervals takes longer. Dial down volume in the next couple of days and sleep is the priority.');
  }

  return {
    headline: `${iv.repCount} × ~${repDist}m intervals`,
    signals,
    wentWell,
    focusNext,
  };
}
