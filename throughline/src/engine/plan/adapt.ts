/**
 * Adaptation rule layer — the coach's manual autoregulation, made explicit and
 * version-controlled. Consumes readiness band + soreness + injuries + missed
 * sessions and edits the week.
 *
 * Principles:
 *  - PINNED days are never modified (coach intent is law; planner routes around).
 *  - Every change is recorded with a reason — this is labeled training data.
 *  - Rules are deliberately simple and inspectable, not a learned policy.
 *
 * Her language, encoded:
 *  - "cut shorter or take the day off if sharply sore"  → soreness/low readiness
 *  - "5 or even 4 miles if very sore"                    → reduce volume
 *  - "day off if feverish"                               → illness → rest
 *  - "strides only if feeling good"                      → gate optional work
 *  - "2+ missed → don't cram, re-periodize"             → hold, don't pile on
 */
import type { PlannedWeek, PlannedDay, ReadinessBandByDay } from './types';

export type AdaptationReason =
  | 'low_readiness'
  | 'high_soreness'
  | 'injury_modality'
  | 'missed_sessions'
  | 'optional_dropped';

export interface AdaptationChange {
  day: string;
  reason: AdaptationReason;
  before: string;
  after: string;
  note: string;
}

export interface ActiveInjury {
  bodyPart: string;
  allowedModalities: string[]; // e.g. ['bike','pool_run']; running allowed if includes 'run'
}

export interface AdaptContext {
  /** Per-day readiness band ('easy' | 'normal' | 'go'), keyed by 'YYYY-MM-DD'. */
  readiness?: ReadinessBandByDay;
  /** Per-day soreness 0-10, keyed by day. */
  soreness?: Record<string, number>;
  injuries?: ActiveInjury[];
  /** Sessions missed in the trailing 7 days (drives the no-cramming rule). */
  missedSessionsLast7?: number;
}

const SORENESS_HARD = 7;
const VOLUME_CUT = 0.8; // 20% reduction when backing off

export function adaptWeek(
  week: PlannedWeek,
  ctx: AdaptContext,
): { week: PlannedWeek; changes: AdaptationChange[] } {
  const changes: AdaptationChange[] = [];
  const runningBlocked = (ctx.injuries ?? []).find(
    (i) => !i.allowedModalities.includes('run'),
  );

  const days = week.days.map((d) => {
    if (d.pinned || d.runType === 'rest') return d;

    const band = ctx.readiness?.[d.day];
    const soreness = ctx.soreness?.[d.day];
    let next = d;

    // 1) Injury that bars running → swap to an allowed cross-training modality.
    if (runningBlocked) {
      const before = describe(next);
      next = {
        ...next,
        runType: 'cross_train',
        zone: null,
        segments: undefined,
        optionalStrides: false,
        description: `Cross-train (${runningBlocked.allowedModalities.join('/')}) ~${minutesFor(
          next,
        )} min, protect ${runningBlocked.bodyPart}. No running until cleared.`,
      };
      changes.push({
        day: d.day,
        reason: 'injury_modality',
        before,
        after: describe(next),
        note: `Active injury (${runningBlocked.bodyPart}); running not in allowed modalities.`,
      });
      return next; // injury dominates; skip other downgrades
    }

    // 2) Low readiness or hard soreness on a hard day → downgrade + shorten.
    const hardDay = next.runType === 'quality' || next.runType === 'long';
    if (hardDay && (band === 'easy' || (soreness ?? 0) >= SORENESS_HARD)) {
      const before = describe(next);
      const reduced = Math.round(next.distanceMeters * VOLUME_CUT);
      next = {
        ...next,
        runType: 'easy',
        zone: 'easy',
        segments: undefined,
        warmup: undefined,
        cooldown: undefined,
        distanceMeters: reduced,
        description: `Eased off the planned ${d.runType}: run easy, shorten as needed. Quality moved, don't force it today.`,
      };
      changes.push({
        day: d.day,
        reason: band === 'easy' ? 'low_readiness' : 'high_soreness',
        before,
        after: describe(next),
        note:
          band === 'easy'
            ? 'Readiness low, swap quality/long for easy (her: "cut shorter or take the day off").'
            : `Soreness ${soreness}/10, reduce intensity (her: "5 or even 4 miles if very sore").`,
      });
      return next;
    }

    // 3) Optional strides gated on feeling good.
    if (next.optionalStrides && band && band !== 'go') {
      changes.push({
        day: d.day,
        reason: 'optional_dropped',
        before: 'optional strides',
        after: 'no strides',
        note: 'Strides only if feeling good, readiness not green.',
      });
      next = { ...next, optionalStrides: false };
    }

    return next;
  });

  // 4) Missed-session guard: don't cram volume back; flag for re-periodization.
  if ((ctx.missedSessionsLast7 ?? 0) >= 2) {
    changes.push({
      day: week.weekStart,
      reason: 'missed_sessions',
      before: `${formatMiles(week.targetVolumeMeters)} target`,
      after: 'hold volume; re-periodize',
      note: '2+ missed sessions, hold volume, do not cram. Re-periodize rather than make it up.',
    });
  }

  return { week: { ...week, days }, changes };
}

function describe(d: PlannedDay): string {
  return `${d.runType}${d.zone ? ` (${d.zone})` : ''} ${formatMiles(d.distanceMeters)}`;
}

function formatMiles(meters: number): string {
  return `${Math.round((meters / 1000 / 1.609344) * 10) / 10} mi`;
}

function minutesFor(d: PlannedDay): number {
  // ~7:30/mi-equivalent effort for cross-training time estimate.
  return Math.round((d.distanceMeters / 1000 / 1.609344) * 7.5);
}
