/**
 * PURE autonomous-mode readiness gate (no DB).
 *
 * Coaching principle (Peter): in ASSISTED mode a coach sees the wearable
 * signal and decides — so we only advise. In AUTONOMOUS mode there is no coach
 * in the loop, and wearable data alone is a shaky basis for downgrading a
 * session (a low HRV can come from a late meal, a drink, or travel, not real
 * fatigue). So instead of silently easing, the app ASKS the athlete how they
 * feel and lets their answer be the tiebreaker:
 *
 *   - low markers, not asked yet          → ask "how are you feeling?"
 *   - low markers + they feel it too       → recommend easing (they agree)
 *   - low markers + they feel good         → keep the session, trust the body
 *
 * The athlete's answer is captured as a normal check-in, so it also flows back
 * into the readiness engine (which re-fuses subjective + physiology).
 */
import { isQualitySession } from './nextStepLogic';

export interface ReadinessGateInput {
  coachingMode: 'assisted' | 'autonomous';
  band: 'easy' | 'normal' | 'go' | null;
  sessionType: string | null; // today's planned session, if any
  ranToday: boolean;
  isRestDay: boolean;
  checkedInToday: boolean;
  energy: number | null; // today's check-in, if present (0-10)
  soreness: number | null; // today's check-in, if present (0-10)
}

export type ReadinessGate =
  | { kind: 'none' }
  | { kind: 'ask'; title: string; body: string }
  | { kind: 'ease'; title: string; body: string }
  | { kind: 'hold'; title: string; body: string };

/** Feels rough enough to agree with a low-recovery read. */
function feelsRough(energy: number | null, soreness: number | null): boolean {
  return (energy != null && energy <= 5) || (soreness != null && soreness >= 6);
}

export function decideReadinessGate(i: ReadinessGateInput): ReadinessGate {
  // Only autonomous athletes go through the gate; assisted mode advises instead.
  if (i.coachingMode !== 'autonomous') return { kind: 'none' };
  // Nothing to reconsider if the work is done or it's a rest day.
  if (i.ranToday || i.isRestDay) return { kind: 'none' };
  // Only low recovery on an intensity/volume day is worth interrupting for.
  if (i.band !== 'easy') return { kind: 'none' };
  if (!i.sessionType || !isQualitySession(i.sessionType)) return { kind: 'none' };

  if (!i.checkedInToday) {
    return {
      kind: 'ask',
      title: 'Your recovery is reading low today',
      body: "Before I change anything, how are you actually feeling? Your read on it matters more than the numbers.",
    };
  }

  if (feelsRough(i.energy, i.soreness)) {
    return {
      kind: 'ease',
      title: "Let's take today down a notch",
      body: "Your recovery markers are low and you're feeling it too. Swap today's hard work for easy miles or a shorter effort — consistency over the month beats forcing one session.",
    };
  }

  return {
    kind: 'hold',
    title: "Markers are low, but you feel good — keeping today",
    body: "Your recovery data is a little low, but you're feeling fine, so we'll run today as planned. Start easy; if the legs feel flat in the first mile, back off — no hero sessions.",
  };
}
