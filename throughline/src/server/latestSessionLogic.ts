/**
 * PURE view builder for the "latest session" card (no DB) — turns a completed
 * bike / swim / strength activity into a sport-native summary. Running has its
 * own richer coach debrief (runFeedback); this is the multisport twin so a ride
 * or a swim shows as a PRIMARY session, not a "cross-training" footnote.
 *
 * Each sport reads in its own language: cycling as speed (mph/kph), swimming as
 * pace per 100 m, running-adjacent stats stay out of it.
 */
import { fmtDistance, fmtSpeed, type Units } from '@/lib/units';

export type SessionSport = 'bike' | 'swim' | 'strength';

export interface LatestSession {
  activityId: string;
  sport: SessionSport;
  name: string | null;
  day: string;
  daysAgo: number;
  distanceMeters: number | null;
  durationSeconds: number | null;
  elevationGainMeters: number | null;
  avgHr: number | null;
}

export interface SessionStat {
  label: string;
  value: string;
}

export interface SessionSummaryView {
  sport: SessionSport;
  emoji: string;
  /** "Latest ride", "Latest swim", "Latest strength session". */
  title: string;
  /** "3 days ago" / "Today" / "Yesterday". */
  whenLabel: string;
  stats: SessionStat[];
  /** A plain, factual one-liner in the athlete's units. */
  summary: string;
}

const EMOJI: Record<SessionSport, string> = { bike: '🚴', swim: '🏊', strength: '🏋️' };
const TITLE: Record<SessionSport, string> = { bike: 'Latest ride', swim: 'Latest swim', strength: 'Latest strength session' };
const FT_PER_M = 3.280839895;

function whenLabel(daysAgo: number): string {
  if (daysAgo <= 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return `${daysAgo} days ago`;
}

/** "1:12:30" (h:mm:ss) or "48:20" (mm:ss). */
function fmtDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${m}:${String(ss).padStart(2, '0')}`;
}

/** Swim pace as m:ss / 100 m — the number a swimmer actually reads. */
function fmtSwimPer100(distanceMeters: number, durationSeconds: number): string {
  const per100 = durationSeconds / (distanceMeters / 100);
  const m = Math.floor(per100 / 60);
  const s = Math.round(per100 - m * 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

export function buildSessionSummaryView(session: LatestSession, units: Units): SessionSummaryView {
  const { sport, distanceMeters, durationSeconds, elevationGainMeters, avgHr } = session;
  const stats: SessionStat[] = [];
  let summary = '';

  if (sport === 'bike') {
    if (distanceMeters && distanceMeters > 0) stats.push({ label: 'Distance', value: fmtDistance(distanceMeters, units) });
    if (distanceMeters && distanceMeters > 0 && durationSeconds && durationSeconds > 0) {
      const secPerKm = durationSeconds / (distanceMeters / 1000);
      stats.push({ label: 'Avg speed', value: fmtSpeed(secPerKm, units) });
    }
    if (durationSeconds && durationSeconds > 0) stats.push({ label: 'Moving time', value: fmtDuration(durationSeconds) });
    if (elevationGainMeters != null && elevationGainMeters > 0) {
      const climb = units === 'km' ? `${Math.round(elevationGainMeters).toLocaleString()} m` : `${Math.round(elevationGainMeters * FT_PER_M).toLocaleString()} ft`;
      stats.push({ label: 'Climbing', value: climb });
    }
    if (avgHr) stats.push({ label: 'Avg HR', value: `${avgHr} bpm` });
    const dist = distanceMeters && distanceMeters > 0 ? fmtDistance(distanceMeters, units) : null;
    const spd = distanceMeters && durationSeconds ? fmtSpeed(durationSeconds / (distanceMeters / 1000), units) : null;
    summary =
      dist && spd
        ? `A ${dist} ride at ${spd}. Aerobic work in the legs without the pounding.`
        : durationSeconds && durationSeconds > 0
          ? `A ${fmtDuration(durationSeconds)} ride in the books.`
          : 'Ride logged.';
  } else if (sport === 'swim') {
    if (distanceMeters && distanceMeters > 0) stats.push({ label: 'Distance', value: `${Math.round(distanceMeters).toLocaleString()} m` });
    if (distanceMeters && distanceMeters > 0 && durationSeconds && durationSeconds > 0) {
      stats.push({ label: 'Pace', value: `${fmtSwimPer100(distanceMeters, durationSeconds)}/100m` });
    }
    if (durationSeconds && durationSeconds > 0) stats.push({ label: 'Time', value: fmtDuration(durationSeconds) });
    if (avgHr) stats.push({ label: 'Avg HR', value: `${avgHr} bpm` });
    summary =
      distanceMeters && distanceMeters > 0
        ? `${Math.round(distanceMeters).toLocaleString()} m in the water${durationSeconds && durationSeconds > 0 ? ` at ${fmtSwimPer100(distanceMeters, durationSeconds)}/100m` : ''}.`
        : 'Swim logged.';
  } else {
    // strength
    if (durationSeconds && durationSeconds > 0) stats.push({ label: 'Duration', value: fmtDuration(durationSeconds) });
    if (avgHr) stats.push({ label: 'Avg HR', value: `${avgHr} bpm` });
    summary =
      durationSeconds && durationSeconds > 0
        ? `A ${fmtDuration(durationSeconds)} strength session. Durability work that protects the endurance training.`
        : 'Strength session logged.';
  }

  return {
    sport,
    emoji: EMOJI[sport],
    title: TITLE[sport],
    whenLabel: whenLabel(session.daysAgo),
    stats,
    summary,
  };
}
