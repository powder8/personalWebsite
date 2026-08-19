/**
 * PURE post-run assessment ("Coach's take") — compares a completed run to the
 * planned session for that day and produces an encouraging, specific verdict.
 * No DB; unit-testable. Voice: a good coach — celebrate what went right, and
 * give ONE useful nudge (the most common error is running easy days too hard).
 */
import { secPerKmToMinPerMile } from '@/engine/plan';

export interface PlannedRef {
  sessionType: string; // easy | recovery | long | threshold | intervals | marathon | ...
  zone: string | null;
  miles: number;
  paceFastSecPerKm: number | null; // band fast bound (lower = faster)
  paceSlowSecPerKm: number | null; // band slow bound
}

export interface RunVsPlan {
  actualMiles: number;
  actualPaceSecPerKm: number | null;
  planned: PlannedRef | null;
}

export type RunVerdict =
  | 'nailed' // quality session right in the band
  | 'solid' // on plan
  | 'too_fast_easy' // easy/recovery run faster than it should be (the classic mistake)
  | 'too_hard' // quality run well faster than band (risky)
  | 'eased_off' // quality run slower than band
  | 'short' // came up well short on distance
  | 'extra' // unplanned bonus run / no session today
  | 'logged'; // ran, but not enough info to judge pace

export interface RunFeedback {
  verdict: RunVerdict;
  positive: boolean; // drives card tone
  headline: string;
  detail: string;
}

const TOL_SEC_PER_KM = 6.2; // ~10 s/mi tolerance around band bounds
const EASY_TYPES = new Set(['easy', 'recovery', 'maintenance', 'long']);
const QUALITY_TYPES = new Set(['threshold', 'tempo', 'intervals', 'interval', 'rep', 'marathon', 'race']);

const pm = (secPerKm: number) => `${secPerKmToMinPerMile(secPerKm)}/mi`;
const miStr = (m: number) => (m % 1 === 0 ? `${m}` : m.toFixed(1));

export function assessRun(input: RunVsPlan): RunFeedback {
  const { actualMiles, actualPaceSecPerKm, planned } = input;
  const actualMi = Math.round(actualMiles * 10) / 10;

  // No planned session that day → bonus run.
  if (!planned || planned.sessionType === 'rest' || planned.miles <= 0) {
    return {
      verdict: 'extra',
      positive: true,
      headline: 'Bonus miles 🙌',
      detail: `${miStr(actualMi)} mi that weren't even on the plan, love the consistency. Just keep extra runs truly easy so they don't tax your hard days.`,
    };
  }

  const plannedMi = Math.round(planned.miles * 10) / 10;
  const distRatio = plannedMi > 0 ? actualMi / plannedMi : 1;
  const isEasy = EASY_TYPES.has(planned.sessionType);
  const isQuality = QUALITY_TYPES.has(planned.sessionType) || (planned.zone != null && ['threshold', 'interval', 'rep', 'marathon'].includes(planned.zone));
  const fast = planned.paceFastSecPerKm; // lower = faster
  const slow = planned.paceSlowSecPerKm;

  // --- Pace judgment (only when we have both a band and an actual pace) ---
  if (actualPaceSecPerKm != null && fast != null && slow != null) {
    const ranFasterThanBand = actualPaceSecPerKm < fast - TOL_SEC_PER_KM;
    const ranSlowerThanBand = actualPaceSecPerKm > slow + TOL_SEC_PER_KM;
    const inBand = !ranFasterThanBand && !ranSlowerThanBand;

    if (isEasy && ranFasterThanBand) {
      return {
        verdict: 'too_fast_easy',
        positive: false,
        headline: 'Strong run, but a touch quick',
        detail: `That was an easy day and you ran ${pm(actualPaceSecPerKm)}, quicker than the ${pm(fast)}-${pm(slow)} target. It's the most common mistake in running: easy needs to be genuinely easy so your hard days land. Next one, hold back and let it feel boring.`,
      };
    }
    if (isQuality && ranFasterThanBand) {
      return {
        verdict: 'too_hard',
        positive: false,
        headline: 'Hammered it 🔥, maybe a bit much',
        detail: `${pm(actualPaceSecPerKm)} is faster than the ${pm(fast)}-${pm(slow)} target for this one. Strong, but racing your workouts steals from race day. Aim to finish feeling you had one more rep in the tank.`,
      };
    }
    if (isQuality && inBand) {
      return {
        verdict: 'nailed',
        positive: true,
        headline: 'Nailed it 🎯',
        detail: `${miStr(actualMi)} mi at ${pm(actualPaceSecPerKm)}, right in the ${pm(fast)}-${pm(slow)} target. This is exactly the work that moves your race time. Recover well.`,
      };
    }
    if (isQuality && ranSlowerThanBand) {
      return {
        verdict: 'eased_off',
        positive: true,
        headline: 'Got it done',
        detail: `A bit easier than the ${pm(fast)}-${pm(slow)} target, totally fine, some days the legs aren't there and showing up still counts. If it keeps happening, tell your coach and we'll adjust.`,
      };
    }
    if (isEasy && inBand) {
      return {
        verdict: 'solid',
        positive: true,
        headline: 'Textbook easy day ✅',
        detail: `${miStr(actualMi)} mi at ${pm(actualPaceSecPerKm)}, right in the easy zone. Disciplined easy running is the quiet engine of every PB.`,
      };
    }
  }

  // --- Distance fallback when pace isn't conclusive ---
  if (distRatio < 0.8) {
    return {
      verdict: 'short',
      positive: true,
      headline: 'Banked something',
      detail: `${miStr(actualMi)} of the planned ${miStr(plannedMi)} mi, life happens, and a short run beats a skipped one. No need to make it up; just roll into the next session.`,
    };
  }

  return {
    verdict: 'solid',
    positive: true,
    headline: 'On plan ✅',
    detail: `${miStr(actualMi)} mi${actualPaceSecPerKm != null ? ` at ${pm(actualPaceSecPerKm)}` : ''}, right where it should be. Consistency like this is what builds the result.`,
  };
}
