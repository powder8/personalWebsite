/**
 * PURE fitness-grounding check (no DB) — reconciles the fitness ANCHOR (what
 * the plan's paces are computed from) against DEMONSTRATED fitness (the best
 * recent real effort) and the athlete's STATED goal.
 *
 * Why this exists: every prescribed pace flows from the anchor. If the anchor
 * is an old PR, an optimistic self-report, or an intake guess, the app will
 * confidently prescribe paces the athlete has never run — which is exactly what
 * makes a coach stop trusting it. This produces an honest, specific verdict and
 * tells the UI whether to offer "anchor to my recent runs instead".
 */
export interface DemonstratedEffort {
  vdot: number;
  distanceLabel: string; // e.g. "10K"
  timeLabel: string; // e.g. "38:42"
  paceLabel: string; // e.g. "6:14/mi"
  day: string; // YYYY-MM-DD
  gradeAdjusted?: boolean; // VDOT read on grade-adjusted pace (hilly effort)
}

export type GroundingStatus = 'no_data' | 'confirmed' | 'optimistic' | 'conservative';

export interface Grounding {
  status: GroundingStatus;
  anchorVdot: number | null;
  demonstrated: DemonstratedEffort | null;
  deltaVdot: number | null; // anchor − demonstrated (positive = anchor faster than shown)
  goalStretch: boolean; // stated goal materially faster than demonstrated fitness
  headline: string;
  note: string;
  /** Offer the "use my recent runs" action (anchor is out of step with reality). */
  offerRecentAnchor: boolean;
}

// VDOT gap that counts as "materially different" (~8–10 s/mi at 5K pace).
const DELTA = 2.0;
const GOAL_STRETCH_DELTA = 3.0;

export function assessGrounding(input: {
  anchorVdot: number | null;
  anchor5kLabel?: string | null; // the 5K time the anchor implies, for the note
  demonstrated: DemonstratedEffort | null;
  statedGoalVdot?: number | null;
  statedGoalLabel?: string | null; // e.g. "2:38 marathon"
}): Grounding {
  const { anchorVdot, demonstrated } = input;
  const d = demonstrated?.vdot ?? null;
  const goalStretch = input.statedGoalVdot != null && d != null && input.statedGoalVdot - d > GOAL_STRETCH_DELTA;
  const goalTail =
    goalStretch && input.statedGoalLabel
      ? ` Heads up: your goal (${input.statedGoalLabel}) is a big step up from what your runs show today — reachable, but it's a stretch, not your current level.`
      : '';

  if (anchorVdot == null || demonstrated == null || d == null) {
    return {
      status: 'no_data',
      anchorVdot,
      demonstrated,
      deltaVdot: null,
      goalStretch,
      headline: 'Targets are provisional',
      note:
        'These paces come from your stated goal, not from runs we’ve seen yet. Connect Strava or log a few runs and we’ll calibrate them to your real fitness.',
      offerRecentAnchor: false,
    };
  }

  const delta = Math.round((anchorVdot - d) * 10) / 10;
  const anchorTail = input.anchor5kLabel ? ` (≈ a ${input.anchor5kLabel} 5K)` : '';
  const hillTag = demonstrated.gradeAdjusted ? ', grade-adjusted for the hills' : '';

  if (delta > DELTA) {
    return {
      status: 'optimistic',
      anchorVdot,
      demonstrated,
      deltaVdot: delta,
      goalStretch,
      headline: 'These targets look fast for your recent running',
      note:
        `Your paces assume VDOT ${round(anchorVdot)}${anchorTail}, but your best recent effort — ${demonstrated.distanceLabel} ${demonstrated.timeLabel} (${demonstrated.paceLabel}) on ${demonstrated.day}${hillTag} — is about VDOT ${round(d)}. ` +
        `We can keep these as goal targets, or re-anchor to what you’ve actually run so day-to-day paces feel right.${goalTail}`,
      offerRecentAnchor: true,
    };
  }

  if (delta < -DELTA) {
    return {
      status: 'conservative',
      anchorVdot,
      demonstrated,
      deltaVdot: delta,
      goalStretch,
      headline: 'You’re running faster than your targets',
      note:
        `Your ${demonstrated.distanceLabel} ${demonstrated.timeLabel} (${demonstrated.paceLabel}) on ${demonstrated.day}${hillTag} suggests VDOT ${round(d)}, ahead of your current anchor (VDOT ${round(anchorVdot)}). ` +
        `Want to raise your targets to match your fitness?`,
      offerRecentAnchor: true,
    };
  }

  return {
    status: 'confirmed',
    anchorVdot,
    demonstrated,
    deltaVdot: delta,
    goalStretch,
    headline: 'Backed by your recent running',
    note: `Your ${demonstrated.distanceLabel} ${demonstrated.timeLabel} (${demonstrated.paceLabel}) on ${demonstrated.day}${hillTag} lines up with these targets (VDOT ~${round(anchorVdot)}).${goalTail}`,
    offerRecentAnchor: false,
  };
}

const round = (v: number) => Math.round(v * 10) / 10;
