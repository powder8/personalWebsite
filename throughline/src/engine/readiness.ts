/**
 * Readiness assessment v0.
 *
 * Combines physiological z-scores (HRV, resting HR, sleep — all vs the
 * athlete's own baseline) with the latest subjective check-in (soreness,
 * energy, yesterday's RPE) into a small, interpretable score, a band, and ONE
 * defensible sentence. Every call lists the signals that drove it.
 *
 * Determinism (architecture principle 1): no LLM, no clock, no randomness. The
 * sentence is generated from the structured drivers. An LLM only re-phrases
 * this for the athlete later (Phase 5) — it never decides readiness.
 */
import type {
  ReadinessInput,
  ReadinessResult,
  ReadinessDriver,
  ReadinessBand,
  EngineParams,
  DriverKey,
} from './types';

export const DEFAULT_PARAMS: EngineParams = {
  conservatism: 0.5,
  weights: {
    hrv: 1,
    resting_hr: 1,
    sleep: 0.8,
    soreness: 1,
    energy: 0.6,
    yesterday_rpe: 0.4,
  },
};

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Map a z-score to a bounded [-1, 1] sub-score (±2σ saturates). */
function zScore(z: number): number {
  return clamp(z, -2, 2) / 2;
}

/** Map a 0-10 subjective value to [-1, 1] around the neutral midpoint of 5. */
function subjective(v: number): number {
  return clamp((v - 5) / 5, -1, 1);
}

const BAND_THRESHOLD = 0.25;

export function assessReadiness(
  input: ReadinessInput,
  params: EngineParams = DEFAULT_PARAMS,
): ReadinessResult {
  const w = { ...DEFAULT_PARAMS.weights, ...params.weights };
  const drivers: ReadinessDriver[] = [];

  const add = (key: DriverKey, base: number, value: number, note: string) => {
    const weight = w[key] ?? 1;
    drivers.push({ key, contribution: base * weight, value, note });
  };

  // Physiological — interpreted as z-scores vs own baseline.
  if (input.hrvZ != null) {
    add('hrv', zScore(input.hrvZ), input.hrvZ, hrvNote(input));
  }
  if (input.restingHrZ != null) {
    // Higher resting HR vs baseline is worse → invert.
    add('resting_hr', zScore(-input.restingHrZ), input.restingHrZ, rhrNote(input.restingHrZ));
  }
  if (input.sleepZ != null) {
    add('sleep', zScore(input.sleepZ), input.sleepZ, sleepNote(input.sleepZ));
  }

  // Subjective — self-anchored 0-10 scales.
  if (input.soreness != null) {
    // Higher soreness is worse → invert around midpoint.
    add('soreness', subjective(10 - input.soreness), input.soreness, `soreness ${input.soreness}/10`);
  }
  if (input.energy != null) {
    add('energy', subjective(input.energy), input.energy, `energy ${input.energy}/10`);
  }
  if (input.yesterdayRpe != null) {
    // Hard yesterday → residual fatigue → mild negative.
    add('yesterday_rpe', subjective(10 - input.yesterdayRpe) * 0.5, input.yesterdayRpe, `yesterday's RPE ${input.yesterdayRpe}/10`);
  }

  // Weighted mean of contributions, in [-1, 1].
  const usedWeight = drivers.reduce((s, d) => s + (w[d.key] ?? 1), 0);
  const raw = usedWeight > 0 ? drivers.reduce((s, d) => s + d.contribution, 0) / usedWeight : 0;

  // Conservatism shifts the score: >0.5 nudges toward easy, <0.5 toward go.
  const adjusted = clamp(raw - (params.conservatism - 0.5) * 0.6, -1, 1);

  const band: ReadinessBand =
    adjusted >= BAND_THRESHOLD ? 'go' : adjusted <= -BAND_THRESHOLD ? 'easy' : 'normal';

  const score = Math.round(((adjusted + 1) / 2) * 100);

  // Sufficient data = at least one physiological signal present.
  const sufficientData =
    input.hrvZ != null || input.restingHrZ != null || input.sleepZ != null;

  drivers.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return {
    day: input.day,
    score,
    band,
    sentence: buildSentence(drivers, band, sufficientData),
    drivers,
    sufficientData,
  };
}

// --- deterministic note + sentence helpers ---

function hrvNote(input: ReadinessInput): string {
  const z = input.hrvZ!;
  const dir = z < 0 ? 'suppressed' : 'elevated';
  const days =
    input.hrvDaysSuppressed && input.hrvDaysSuppressed > 1 && z < 0
      ? ` ${input.hrvDaysSuppressed} days`
      : '';
  return `HRV ${dir} ${Math.abs(z).toFixed(1)}σ vs baseline${days}`;
}

function rhrNote(z: number): string {
  return z > 0 ? `resting HR elevated ${z.toFixed(1)}σ` : `resting HR ${Math.abs(z).toFixed(1)}σ below baseline`;
}

function sleepNote(z: number): string {
  return z < 0 ? `sleep ${Math.abs(z).toFixed(1)}σ below normal` : `sleep ${z.toFixed(1)}σ above normal`;
}

const RECOMMENDATION: Record<ReadinessBand, string> = {
  easy: 'today should be easy',
  normal: 'a normal session is fine',
  go: 'green light for quality',
};

function buildSentence(
  drivers: ReadinessDriver[],
  band: ReadinessBand,
  sufficientData: boolean,
): string {
  if (drivers.length === 0) {
    return 'No signals available yet — defaulting to a normal session.';
  }

  // Pick the drivers that most justify the call: for easy/normal, the most
  // negative; for go, the most positive. Use the top two by magnitude.
  const relevant = drivers
    .filter((d) => (band === 'go' ? d.contribution > 0 : d.contribution < 0))
    .slice(0, 2);
  const chosen = relevant.length > 0 ? relevant : drivers.slice(0, 2);

  const phrases = chosen.map((d) => d.note).join(' and ');
  const caveat = sufficientData ? '' : ' (limited baseline data)';
  return `${capitalize(phrases)} — ${RECOMMENDATION[band]}${caveat}.`;
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
