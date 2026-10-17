/**
 * PURE cross-source workout matching (no DB). One session often reaches us
 * twice: a watch ride lands via Strava AND Whoop auto-detects it; an Apple
 * Watch run arrives via HealthKit AND Strava. Each source has its own id, so
 * the unique sourceRef can't catch it. Rich sources (Strava, Garmin: splits,
 * route, power) win; THIN sources (phone health stores, Whoop) yield.
 *
 * Two recordings are the same session when they are the same sport and their
 * time windows mostly overlap. You can't do two runs at once, so heavy
 * same-sport overlap means one session, even if one source caught only part
 * of it (Whoop detecting the back half of a ride) or counts stops differently
 * (Strava moving time vs a wearable's elapsed time).
 */

/** Sources that only ever hold a thin copy of a session. */
export const THIN_PROVIDERS = ['apple', 'health_connect', 'whoop'] as const;
export type ThinProvider = (typeof THIN_PROVIDERS)[number];
export const isThinProvider = (p: string): p is ThinProvider => (THIN_PROVIDERS as readonly string[]).includes(p);

export interface WorkoutKey {
  /** Optional because insert rows may omit it (the column defaults to 'run'). */
  sport?: string | null;
  startTime: Date;
  /** Moving time. */
  durationSeconds?: number | null;
  /** Wall-clock time incl. stops, when known. The window uses the longer of the two. */
  elapsedSeconds?: number | null;
}

/** Overlap needed, as a share of the SHORTER window, to call it one session. */
export const MIN_OVERLAP = 0.5;
/** With no duration on one side, starts this close together are the same session. */
export const DUP_START_WINDOW_SEC = 5 * 60;
/** How far back to look for an earlier-starting recording that overlaps (query padding). */
export const LOOKBACK_SEC = 12 * 3600;

/** 'other' is a catch-all (Whoop's generic "Activity"): it matches any sport. */
function sportsMatch(a: WorkoutKey, b: WorkoutKey): boolean {
  const sa = a.sport ?? 'run';
  const sb = b.sport ?? 'run';
  return sa === sb || sa === 'other' || sb === 'other';
}

function windowSec(k: WorkoutKey): number | null {
  const d = Math.max(k.durationSeconds ?? 0, k.elapsedSeconds ?? 0);
  return d > 0 ? d : null;
}

/** End instant (ms) of a recording, or null when its length is unknown. */
export function workoutEndMs(k: WorkoutKey): number | null {
  const w = windowSec(k);
  return w == null ? null : k.startTime.getTime() + w * 1000;
}

export function isSameWorkout(a: WorkoutKey, b: WorkoutKey): boolean {
  if (!sportsMatch(a, b)) return false;
  const wa = windowSec(a);
  const wb = windowSec(b);
  const sa = a.startTime.getTime();
  const sb = b.startTime.getTime();
  if (wa == null || wb == null) return Math.abs(sa - sb) <= DUP_START_WINDOW_SEC * 1000;
  const overlap = Math.min(sa + wa * 1000, sb + wb * 1000) - Math.max(sa, sb);
  return overlap > 0 && overlap >= MIN_OVERLAP * Math.min(wa, wb) * 1000;
}
