/**
 * What VDOT did each run actually demonstrate?
 *
 * The single source of truth for scoring run efforts, shared by the fitness
 * ANCHOR (server/anchor.ts picks the best of these) and the fitness TREND
 * (server/fitnessProgress.ts charts them over time) — so the number you're
 * anchored to and the number on your progress chart can never disagree.
 *
 * Deliberately free of `server-only` so it stays unit-testable; it touches the
 * DB through the injected `db` handle like the rest of the server layer.
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { DB } from '@/db';
import { activities } from '@/db/schema';
import { vdotFromRace, STANDARD_DISTANCES, gapFromSplits, bestEffortAcross, type GapSplit, type EffortSegment } from '@/engine/plan';
import { vdotCeiling, isCorroborated, isRaceEffort, isHardEffort, type Effort } from '@/server/perf';

// Race-like distances only: long enough that whole-activity time approximates a
// real effort, short enough to exclude long slow runs (~1.9 mi to half).
const MIN_M = 3000;
const MAX_M = 21100;

export interface AnchorCandidate {
  day: string;
  name: string | null;
  distanceMeters: number;
  durationSeconds: number;
  distanceLabel: string; // nearest standard distance, e.g. "5K", "Half"
  timeLabel: string;
  paceLabel: string; // min/mi (actual)
  vdot: number; // fitness, computed on grade-adjusted effort when hilly
  gradeAdjusted: boolean; // VDOT used grade-adjusted pace (hilly run)
  climbMeters: number; // total ascent, when known
}

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}
function paceMinPerMile(distanceMeters: number, seconds: number): string {
  const secPerMile = seconds / (distanceMeters / 1609.344);
  const m = Math.floor(secPerMile / 60);
  const s = Math.round(secPerMile % 60);
  return `${m}:${String(s).padStart(2, '0')}/mi`;
}
function nearestStandard(meters: number): string {
  let best = STANDARD_DISTANCES[0];
  let bestErr = Infinity;
  for (const d of STANDARD_DISTANCES) {
    const err = Math.abs(d.meters - meters) / d.meters;
    if (err < bestErr) {
      bestErr = err;
      best = d;
    }
  }
  return bestErr <= 0.06 ? best.label : `${(meters / 1609.344).toFixed(1)} mi`;
}

/**
 * Best recent run efforts as anchor candidates. Looks within `days` of the
 * athlete's most-recent run (so it works for current AND historical imports),
 * computes a VDOT per qualifying run, and returns the highest few (de-duped by
 * implied VDOT). Race-titled efforts are nudged ahead on ties.
 */
/** One run effort with the VDOT it demonstrated, after glitch guards. The
 *  shared source of truth for "how fit did this run show you were" — used both
 *  to pick an anchor (below) and to trend fitness over time (fitnessProgress). */
export type ScoredRunEffort = AnchorCandidate & {
  ts: number;
  rawVdot: number;
  isRace: boolean;
  trusted: boolean;
};

export async function scoredRunEfforts(
  db: DB,
  athleteId: string,
  opts: { days?: number; limit?: number; sinceDay?: string } = {},
): Promise<ScoredRunEffort[]> {
  // Wide enough to catch a recent goal race (a marathon block can be months
  // back), while still recent enough to reflect current fitness.
  const { days = 270, sinceDay } = opts;

  const [latest] = await db
    .select({ startTime: activities.startTime })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), eq(activities.sport, 'run')))
    .orderBy(desc(activities.startTime))
    .limit(1);
  if (!latest?.startTime) return [];

  // `sinceDay` (an absolute floor) caps how far back we look — used when anchoring
  // to enforce a recency/relevance window measured from *today*, not the latest run.
  const cutoff = sinceDay
    ? new Date(`${sinceDay}T00:00:00.000Z`)
    : new Date(latest.startTime.getTime() - days * 86400000);
  const rows = await db
    .select({
      startTime: activities.startTime,
      name: activities.name,
      workoutType: activities.workoutType,
      distanceMeters: activities.distanceMeters,
      durationSeconds: activities.durationSeconds,
      avgPaceSecPerKm: activities.avgPaceSecPerKm,
      avgHr: activities.avgHr,
      maxHr: activities.maxHr,
      splits: activities.splits,
      laps: activities.laps,
    })
    .from(activities)
    .where(
      and(
        eq(activities.athleteId, athleteId),
        eq(activities.sport, 'run'),
        gte(activities.startTime, cutoff),
        lte(activities.startTime, latest.startTime),
        // ANY source — Strava, Garmin, or an imported training log. Past
        // performance grounds the anchor regardless of how it got here.
      ),
    );

  const scored: (AnchorCandidate & { ts: number; rawVdot: number; isRace: boolean; trusted: boolean })[] = [];
  for (const r of rows) {
    const m = r.distanceMeters ?? 0;
    // Prefer recorded duration; fall back to distance × avg pace for logs that
    // store pace but not elapsed time (common in imported coach spreadsheets).
    const t =
      r.durationSeconds && r.durationSeconds > 0
        ? r.durationSeconds
        : r.avgPaceSecPerKm && r.avgPaceSecPerKm > 0
          ? Math.round((m / 1000) * r.avgPaceSecPerKm)
          : 0;
    if (m < MIN_M || t <= 0) continue;
    const isRace = isRaceEffort({ workoutType: r.workoutType, name: r.name, meters: m });
    const gap = gapFromSplits(r.splits as GapSplit[] | null);

    // (1) Whole-activity read (grade-adjusted when hilly). Skipped for long
    // non-race runs, whose whole-activity average under-rates fitness — their
    // best-effort block (below) still counts.
    let useMeters = m;
    let useT = t;
    let useVdot: number | null = null;
    let useAvgHr: number | null = r.avgHr;
    let gradeAdjusted = false;
    let climbMeters = 0;
    if (isRace || m <= MAX_M) {
      const effortT = gap?.significant ? Math.round(gap.gapSecPerKm * (m / 1000)) : t;
      const wv = vdotFromRace({ distanceMeters: m, timeSeconds: effortT });
      if (Number.isFinite(wv) && wv >= 20 && wv <= 90) {
        useVdot = wv;
        gradeAdjusted = !!gap?.significant;
        climbMeters = gap?.climbMeters ?? 0;
      }
    }

    // (2) Best sustained effort WITHIN the file (splits/laps) — teases a race or
    // tempo out of a warm-up+effort+cool-down upload, or a rep out of a workout.
    const best = bestEffortAcross(
      r.splits as EffortSegment[] | null,
      r.laps as EffortSegment[] | null,
      MIN_M,
      MAX_M,
    );
    if (best && (useVdot == null || best.vdot > useVdot)) {
      useMeters = best.distanceMeters;
      useT = best.durationSeconds;
      useVdot = best.vdot;
      useAvgHr = best.avgHr;
      gradeAdjusted = false; // segment judged on raw pace
      climbMeters = 0;
    }
    if (useVdot == null) continue;

    // A near-max-HR sustained effort is as trustworthy as a race for anchoring.
    const trusted = isRace || isHardEffort({ avgHr: useAvgHr, maxHr: r.maxHr });
    scored.push({
      day: r.startTime.toISOString().slice(0, 10),
      name: r.name,
      distanceMeters: useMeters,
      durationSeconds: useT,
      distanceLabel: nearestStandard(useMeters),
      timeLabel: fmtTime(useT),
      paceLabel: paceMinPerMile(useMeters, useT),
      gradeAdjusted,
      climbMeters,
      ts: r.startTime.getTime(),
      rawVdot: useVdot,
      isRace,
      trusted,
      // nudge race-grade efforts ahead on ties
      vdot: Math.round((useVdot + (isRace ? 0.0001 : 0)) * 10) / 10,
    });
  }

  // Reject GPS glitches: drop efforts beyond a robust ceiling and require
  // corroboration — but TRUSTED efforts are exempt (a real race, or a sustained
  // near-max-HR effort, can't be a glitch and must still anchor fitness even when
  // it's an isolated peak among easy runs).
  const efforts: Effort[] = scored.map((s) => ({ ts: s.ts, vdot: s.rawVdot }));
  const ceiling = vdotCeiling(efforts.map((e) => e.vdot));
  const guarded = scored.filter(
    (s) => s.trusted || (s.rawVdot <= ceiling && isCorroborated({ ts: s.ts, vdot: s.rawVdot }, efforts)),
  );

  return guarded;
}
