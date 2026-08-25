/**
 * Discipline-aware DISPLAY of structured workout segments — the read-side twin
 * of the discipline-generalized `WorkoutSegment`. One headline per segment:
 *
 *   RUN   distance at pace   — "5 × 1 mi", "2.5 mi"        (unchanged)
 *   BIKE  duration at power  — "5 × 8 min @ 228–263 W"
 *   SWIM  metres at CSS pace — "11 × 100 m @ 1:16–1:20/100m"
 *
 * The family is inferred from the segment's OWN fields, not a passed-in
 * discipline flag: bike segments carry `repSeconds`/`durationSeconds`, swim
 * segments carry a `targetFastSecPer100` CSS target, and running segments carry
 * neither. That keeps running output byte-identical (running never sets the new
 * optional keys, so it always falls through to the original distance-at-pace
 * branch) and means the renderer needs no extra wiring.
 *
 * Pure module (no React, no `server-only`) so it is unit-testable and shared by
 * both the athlete portal and the coach console.
 */
import { wattsLabel } from './powerZonesLogic';
import { formatSecPer100 } from './swimZonesLogic';

/**
 * Structural view of the fields a headline reads. Both the engine's
 * `WorkoutSegment` and the portal's `PortalSegment` satisfy it structurally, so
 * either can be passed without an import cycle into `server-only` code.
 */
export interface DisplaySegment {
  reps?: number;
  // running: distance-at-pace (also reused by swimming for metres)
  repMeters?: number;
  distanceMeters?: number;
  // cycling: duration-at-power
  repSeconds?: number;
  durationSeconds?: number;
  targetLoWatts?: number;
  targetHiWatts?: number;
  // swimming: distance-at-CSS-pace
  targetFastSecPer100?: number;
  targetSlowSecPer100?: number;
}

/** Miles label, matching the original SegmentList formatting exactly. */
const mi = (m?: number) =>
  m == null ? null : (m / 1609.344).toFixed(m >= 1609 ? 1 : 2).replace(/\.00$/, '');

/** Distance label in the athlete's unit, compact (drops trailing ".00"). */
function segDistance(m: number, units: 'mi' | 'km'): string {
  if (units === 'km') {
    const km = m / 1000;
    return `${km.toFixed(km >= 1 ? 1 : 2).replace(/\.00$/, '')} km`;
  }
  return `${mi(m)} mi`;
}

/** A swim segment always carries a CSS-relative pace target (metres-based). */
export function isSwimSegment(s: DisplaySegment): boolean {
  return s.targetFastSecPer100 != null || s.targetSlowSecPer100 != null;
}

/** A bike segment is prescribed by time (and usually power), never by distance. */
export function isBikeSegment(s: DisplaySegment): boolean {
  return s.repSeconds != null || s.durationSeconds != null;
}

/** "8 min" / "45 min" / "30 s" — whole-minute durations read as minutes. */
export function formatDuration(sec: number): string {
  if (sec % 60 === 0) return `${sec / 60} min`;
  if (sec < 60) return `${sec} s`;
  return `${Math.round(sec / 60)} min`;
}

/**
 * Swim CSS-pace suffix, e.g. "1:16–1:20/100m". Collapses to a single value when
 * the band is a point (fast === slow) or only one bound is present.
 */
export function swimPaceSuffix(s: DisplaySegment): string {
  const { targetFastSecPer100: fast, targetSlowSecPer100: slow } = s;
  if (fast == null && slow == null) return '';
  if (fast != null && slow != null && Math.round(fast) !== Math.round(slow)) {
    return `${formatSecPer100(fast)}-${formatSecPer100(slow)}/100m`;
  }
  return `${formatSecPer100((fast ?? slow)!)}/100m`;
}

/** Bike power suffix, e.g. "228–263 W". Empty when the athlete has no power meter. */
export function bikePowerSuffix(s: DisplaySegment): string {
  if (s.targetLoWatts == null || s.targetHiWatts == null) return '';
  return wattsLabel({ loWatts: s.targetLoWatts, hiWatts: s.targetHiWatts });
}

/**
 * Headline for one structured segment, discipline inferred from its own fields.
 * Running is byte-identical to the original SegmentList `headline()`.
 */
export function segmentHeadline(s: DisplaySegment, units: 'mi' | 'km' = 'mi'): string {
  // SWIM — metres at CSS pace (reuses reps/repMeters/distanceMeters for metres).
  if (isSwimSegment(s)) {
    const pace = swimPaceSuffix(s);
    const at = pace ? ` @ ${pace}` : '';
    if (s.reps && s.repMeters) return `${s.reps} × ${Math.round(s.repMeters)} m${at}`;
    return s.distanceMeters ? `${Math.round(s.distanceMeters)} m${at}` : '';
  }
  // BIKE — duration at power.
  if (isBikeSegment(s)) {
    const watts = bikePowerSuffix(s);
    const at = watts ? ` @ ${watts}` : '';
    if (s.reps && s.repSeconds) return `${s.reps} × ${formatDuration(s.repSeconds)}${at}`;
    return s.durationSeconds ? `${formatDuration(s.durationSeconds)}${at}` : '';
  }
  // RUN — distance at pace. A 400 m rep stays metric on both (a track interval).
  if (s.reps && s.repMeters) {
    const rep = s.repMeters === 400 ? '400m' : segDistance(s.repMeters, units);
    return `${s.reps} × ${rep}`;
  }
  return s.distanceMeters ? segDistance(s.distanceMeters, units) : '';
}

/** Discipline of a planned session, as stored on the row / read model. */
export type Discipline = 'run' | 'bike' | 'swim';

/**
 * Short per-day metric for a session in a week view, in the discipline's own
 * currency: run → miles ("8.0 mi"), bike → minutes ("75 min"), swim → km
 * ("2.4 km"). Running output matches the coach console's existing `miles()`
 * column exactly (`'—'` for null, one decimal, no unit — the caller appends it).
 */
export function sessionMetricLabel(input: {
  discipline: Discipline | 'strength';
  distanceMeters: number | null;
  durationSeconds: number | null;
}): string {
  // Bike and strength are both duration-prescribed.
  if (input.discipline === 'bike' || input.discipline === 'strength') {
    const sec = input.durationSeconds ?? 0;
    return sec > 0 ? `${Math.round(sec / 60)} min` : '-';
  }
  if (input.discipline === 'swim') {
    const m = input.distanceMeters ?? 0;
    return m > 0 ? `${(m / 1000).toFixed(1)} km` : '-';
  }
  return input.distanceMeters == null ? '-' : `${(input.distanceMeters / 1609.344).toFixed(1)} mi`;
}
