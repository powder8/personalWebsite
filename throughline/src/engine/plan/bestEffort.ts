/**
 * PURE best-effort extraction — tease the hardest sustained block out of a SINGLE
 * activity, so we don't have to rely on the athlete splitting warm-up / race /
 * cool-down into separate uploads, and so a workout's quality isn't washed out by
 * its whole-activity average.
 *
 * Given an activity's segments (per-mile splits and/or watch laps), it slides a
 * window over them and returns the contiguous block with the highest implied
 * VDOT within an anchor-able distance range. For a 5K race buried in a 7-mile
 * run, that's the race; for a tempo block inside an easy day, that's the tempo.
 *
 * Granularity follows the data: laps resolve true interval boundaries; mile
 * splits resolve mile-and-longer efforts. Sub-mile reps with recoveries won't
 * form a fast *sustained* block (correct — a 400 doesn't imply a race VDOT).
 */
import { vdotFromRace } from './vdot';

export interface EffortSegment {
  distanceMeters: number;
  durationSeconds: number;
  avgHr?: number | null;
}

export interface BestEffort {
  distanceMeters: number;
  durationSeconds: number;
  paceSecPerKm: number;
  avgHr: number | null;
  vdot: number;
}

/**
 * Highest-VDOT contiguous window of `segments` whose total distance falls in
 * [minMeters, maxMeters]. Returns null when no window qualifies.
 */
export function bestSustainedEffort(
  segments: EffortSegment[] | null | undefined,
  minMeters = 3000,
  maxMeters = 21100,
): BestEffort | null {
  if (!segments || segments.length === 0) return null;
  const segs = segments.filter((s) => s.distanceMeters > 0 && s.durationSeconds > 0);
  if (segs.length === 0) return null;

  let best: BestEffort | null = null;
  for (let i = 0; i < segs.length; i++) {
    let dist = 0;
    let time = 0;
    let hrTime = 0; // duration-weighted HR accumulator
    let hrDur = 0;
    for (let j = i; j < segs.length; j++) {
      dist += segs[j].distanceMeters;
      time += segs[j].durationSeconds;
      if (segs[j].avgHr != null) {
        hrTime += segs[j].avgHr! * segs[j].durationSeconds;
        hrDur += segs[j].durationSeconds;
      }
      if (dist < minMeters) continue; // window not long enough yet
      if (dist > maxMeters) break; // overshot, longer windows only get bigger
      const vdot = vdotFromRace({ distanceMeters: dist, timeSeconds: time });
      if (!Number.isFinite(vdot) || vdot < 20 || vdot > 90) continue;
      if (!best || vdot > best.vdot) {
        best = {
          distanceMeters: dist,
          durationSeconds: time,
          paceSecPerKm: (time / dist) * 1000,
          avgHr: hrDur > 0 ? Math.round(hrTime / hrDur) : null,
          vdot: Math.round(vdot * 10) / 10,
        };
      }
    }
  }
  return best;
}

/**
 * Best sustained effort across BOTH the lap and split views of an activity
 * (laps are usually finer; splits are the fallback). Returns the stronger read.
 */
export function bestEffortAcross(
  splits: EffortSegment[] | null | undefined,
  laps: EffortSegment[] | null | undefined,
  minMeters = 3000,
  maxMeters = 21100,
): BestEffort | null {
  const a = bestSustainedEffort(laps, minMeters, maxMeters);
  const b = bestSustainedEffort(splits, minMeters, maxMeters);
  if (!a) return b;
  if (!b) return a;
  return a.vdot >= b.vdot ? a : b;
}
