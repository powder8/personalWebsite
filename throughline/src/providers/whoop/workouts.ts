/**
 * PURE Whoop workout → activity mapping (no I/O). Whoop records workouts you
 * log AND ones it auto-detects from heart rate, which is how bike commutes,
 * hikes and long walks reach us when nothing else recorded them. Whoop is a
 * THIN source: a session Strava also has yields to Strava (see
 * workoutDedupLogic), so only what Whoop alone saw is added.
 */
import type { NormalizedBatch } from '@/providers/types';

/** WHOOP API v2 workout record (GET /v2/activity/workout). */
export interface WhoopWorkout {
  id: string; // UUID
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string; // ISO-8601
  end: string;
  timezone_offset?: string;
  sport_name?: string | null; // 'running' | 'cycling' | 'walking' | 'activity' | …
  sport_id?: number | null; // deprecated in v2; not relied on
  score_state: string; // 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE'
  score?: {
    strain?: number | null;
    average_heart_rate?: number | null;
    max_heart_rate?: number | null;
    kilojoule?: number | null;
    percent_recorded?: number | null;
    distance_meter?: number | null;
    altitude_gain_meter?: number | null;
  } | null;
}

type Sport = 'run' | 'bike' | 'swim' | 'strength' | 'cross_train' | 'other';

/**
 * Whoop sport name → our sport. Matched on fragments because Whoop's list is
 * long and grows ("mountain biking", "spin", "track & field", …).
 */
export function mapWhoopSport(name: string | null | undefined): Sport {
  const n = (name ?? '').toLowerCase();
  if (!n) return 'other';
  if (/swim/.test(n)) return 'swim';
  if (/cycl|bik|spin|peloton/.test(n)) return 'bike';
  if (/run|jog|track/.test(n)) return 'run';
  if (/weight|lift|strength|functional|crossfit|powerlift|hiit|f45|pilates|barre/.test(n)) return 'strength';
  if (/walk|hik|ruck|stair|elliptical|row|ski|paddl|kayak|climb/.test(n)) return 'cross_train';
  return 'other';
}

/** Shorter than this is a blip of elevated HR, not a session. */
export const MIN_WORKOUT_SECONDS = 5 * 60;

type ActivityRow = NonNullable<NormalizedBatch['activities']>[number];

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** One Whoop workout → one activity row, or null when it isn't a real session. */
export function normalizeWhoopWorkout(w: WhoopWorkout): ActivityRow | null {
  if (w.score_state === 'UNSCORABLE') return null;
  const start = new Date(w.start);
  const end = new Date(w.end);
  const seconds = Math.round((end.getTime() - start.getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < MIN_WORKOUT_SECONDS || seconds > 24 * 3600) return null;

  const sc = w.score ?? null;
  const distance = sc?.distance_meter != null && sc.distance_meter > 0 ? sc.distance_meter : null;
  const round = (v: number | null | undefined) => (v == null ? null : Math.round(v));
  return {
    sourceRef: `whoop:${w.id}`,
    sport: mapWhoopSport(w.sport_name),
    name: w.sport_name ? `${titleCase(w.sport_name)} (Whoop)` : 'Activity (Whoop)',
    startTime: start,
    // Whoop has no moving time; its window is wall-clock.
    durationSeconds: seconds,
    elapsedSeconds: seconds,
    distanceMeters: distance,
    avgHr: round(sc?.average_heart_rate),
    maxHr: round(sc?.max_heart_rate),
    avgPaceSecPerKm: distance ? seconds / (distance / 1000) : null,
    elevationGainMeters: sc?.altitude_gain_meter ?? null,
    trainingLoad: null, // derived later by the load model
  };
}
