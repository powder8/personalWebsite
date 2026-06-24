import 'server-only';
/**
 * Fitness-anchor suggestion + assignment.
 *
 * The anchor is the single trusted fitness number (a VDOT, or a race/threshold
 * that derives one). We never silently infer it from noisy training data — but
 * with a full activity history we CAN surface a strong candidate (the best
 * recent effort) and let the coach accept or override. Accepting writes the
 * anchor into paceConfig and re-tunes future planned paces.
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes, activities } from '@/db/schema';
import { vdotFromRace, STANDARD_DISTANCES, gapFromSplits, type AthletePaceConfig, type GapSplit } from '@/engine/plan';
import {
  getAthleteZones,
  getAthleteVdot,
  setAthletePaceConfig,
} from '@/db/paceConfig';
import { reapplyZonesToFuturePlan } from '@/server/paceAdjust';
import { vdotCeiling, isCorroborated, isRaceEffort, type Effort } from '@/server/perf';
import { decideAnchorUpdate } from '@/server/anchorLogic';

// A demonstrated effort older than this no longer reflects current fitness, so
// it won't auto-anchor (an old PR shouldn't drive today's paces).
const ANCHOR_RELEVANCE_DAYS = 180;
// VDOT gap a recent race must clear to override a human-set anchor (autonomous).
const ANCHOR_UPGRADE_DELTA = 2.0;

// Race-like distances only: long enough that whole-activity time ≈ a real
// effort, short enough to exclude long slow runs. (~1.9mi to marathon.)
// Anchor fitness on RACE-ABLE efforts only (~1.9 mi to half-marathon). Longer
// runs are aerobic, run well under race effort, and would under-estimate VDOT.
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
export async function suggestAnchorCandidates(
  db: DB,
  athleteId: string,
  opts: { days?: number; limit?: number; sinceDay?: string } = {},
): Promise<AnchorCandidate[]> {
  // Wide enough to catch a recent goal race (a marathon block can be months
  // back), while still recent enough to reflect current fitness.
  const { days = 270, limit = 3, sinceDay } = opts;

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
      splits: activities.splits,
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

  const scored: (AnchorCandidate & { ts: number; rawVdot: number; isRace: boolean })[] = [];
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
    // Easy long runs (non-race, > half-marathon) under-estimate fitness, so skip
    // them — but a marathon RACE is a valid, important anchor.
    if (!isRace && m > MAX_M) continue;
    // Fitness is an EFFORT measure: judge a hilly effort on grade-adjusted time
    // so a tough climb doesn't under-rate VDOT (and a downhill doesn't inflate it).
    const gap = gapFromSplits(r.splits as GapSplit[] | null);
    const effortT = gap?.significant ? Math.round(gap.gapSecPerKm * (m / 1000)) : t;
    const raw = vdotFromRace({ distanceMeters: m, timeSeconds: effortT });
    if (!Number.isFinite(raw) || raw < 20 || raw > 90) continue;
    scored.push({
      day: r.startTime.toISOString().slice(0, 10),
      name: r.name,
      distanceMeters: m,
      durationSeconds: t,
      distanceLabel: nearestStandard(m),
      timeLabel: fmtTime(t),
      paceLabel: paceMinPerMile(m, t),
      gradeAdjusted: !!gap?.significant,
      climbMeters: gap?.climbMeters ?? 0,
      ts: r.startTime.getTime(),
      rawVdot: raw,
      isRace,
      // nudge race-grade efforts ahead on ties
      vdot: Math.round((raw + (isRace ? 0.0001 : 0)) * 10) / 10,
    });
  }

  // Reject GPS glitches: drop efforts beyond a robust ceiling and require
  // corroboration — but RACES are exempt (a real race can't be a glitch, and an
  // isolated peak race must still anchor fitness).
  const efforts: Effort[] = scored.map((s) => ({ ts: s.ts, vdot: s.rawVdot }));
  const ceiling = vdotCeiling(efforts.map((e) => e.vdot));
  const guarded = scored.filter(
    (s) => s.isRace || (s.rawVdot <= ceiling && isCorroborated({ ts: s.ts, vdot: s.rawVdot }, efforts)),
  );

  // Prefer actual races (most representative of fitness), then by VDOT, then
  // recency — so a recent goal race anchors over a noisy hard training run.
  guarded.sort(
    (a, b) => Number(b.isRace) - Number(a.isRace) || b.vdot - a.vdot || b.day.localeCompare(a.day),
  );
  // De-dupe near-identical VDOTs so the list shows genuinely different options.
  const out: AnchorCandidate[] = [];
  for (const c of guarded) {
    if (out.some((o) => Math.abs(o.vdot - c.vdot) < 0.5)) continue;
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

export type AnchorInput =
  | { kind: 'vdot'; vdot: number }
  | { kind: 'race'; distanceMeters: number; timeSeconds: number }
  | { kind: 'threshold'; thresholdSecPerKm: number };

/** Write the anchor into paceConfig (one source of truth) and re-tune future paces. */
export async function setAnchor(
  db: DB,
  athleteId: string,
  anchor: AnchorInput,
  opts: { today: string; source?: 'auto' | 'manual' },
): Promise<{ vdot: number | null; updatedSessions: number }> {
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) throw new Error(`setAnchor: athlete ${athleteId} not found`);

  const cfg: AthletePaceConfig = { ...((athlete.paceConfig as AthletePaceConfig | null) ?? {}) };
  // Single source of truth: clear all anchor fields, set the chosen one.
  delete cfg.vdot;
  delete cfg.race;
  delete cfg.thresholdSecPerKm;
  if (anchor.kind === 'vdot') {
    if (!Number.isFinite(anchor.vdot) || anchor.vdot < 20 || anchor.vdot > 90) throw new Error('VDOT out of range.');
    cfg.vdot = anchor.vdot;
  } else if (anchor.kind === 'race') {
    if (!(anchor.distanceMeters > 0) || !(anchor.timeSeconds > 0)) throw new Error('Race needs distance and time.');
    cfg.race = { distanceMeters: anchor.distanceMeters, timeSeconds: anchor.timeSeconds };
  } else {
    if (!(anchor.thresholdSecPerKm > 0)) throw new Error('Threshold pace required.');
    cfg.thresholdSecPerKm = anchor.thresholdSecPerKm;
  }
  cfg.anchorSource = opts.source ?? 'manual';

  await setAthletePaceConfig(db, athleteId, cfg);
  const zones = await getAthleteZones(db, athleteId);
  const updatedSessions = zones ? await reapplyZonesToFuturePlan(db, athleteId, opts.today, zones) : 0;
  const vdot = await getAthleteVdot(db, athleteId);
  return { vdot: vdot != null ? Math.round(vdot * 10) / 10 : null, updatedSessions };
}

/**
 * Keep the fitness anchor grounded in the athlete's best RECENT demonstrated
 * race. Safe to call after every import / on portal load:
 *  - An auto/unset anchor tracks the best recent effort (no churn if unchanged).
 *  - A human-set anchor is respected — except a self-coached (autonomous)
 *    athlete whose recent race is clearly faster than their stated number, where
 *    real performance wins over a stale guess.
 *  - Efforts past the relevance window (an old PR) never auto-anchor.
 * Returns the resulting anchor (or the unchanged one).
 */
export async function ensureAutoAnchor(
  db: DB,
  athleteId: string,
  opts: { today: string },
): Promise<{ vdot: number | null; source: 'auto' | 'manual' | 'none' }> {
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return { vdot: null, source: 'none' };
  const cfg = (athlete.paceConfig as AthletePaceConfig | null) ?? {};
  const anchorSource = cfg.anchorSource ?? null;
  const currentVdot = await getAthleteVdot(db, athleteId);
  const autonomous = athlete.coachingMode === 'autonomous';

  // Only consider efforts recent enough to reflect today's fitness.
  const sinceDay = new Date(`${opts.today}T00:00:00.000Z`);
  sinceDay.setUTCDate(sinceDay.getUTCDate() - ANCHOR_RELEVANCE_DAYS);
  const [best] = await suggestAnchorCandidates(db, athleteId, {
    limit: 1,
    sinceDay: sinceDay.toISOString().slice(0, 10),
  });

  const decision = decideAnchorUpdate({
    currentVdot,
    anchorSource,
    autonomous,
    best: best ? { vdot: best.vdot, day: best.day } : null,
    today: opts.today,
    relevanceDays: ANCHOR_RELEVANCE_DAYS,
    upgradeDelta: ANCHOR_UPGRADE_DELTA,
  });

  if (!decision.set || !best) {
    const source: 'auto' | 'manual' | 'none' = anchorSource === 'manual' ? 'manual' : currentVdot != null ? 'auto' : 'none';
    return { vdot: currentVdot != null ? Math.round(currentVdot * 10) / 10 : null, source };
  }

  const res = await setAnchor(
    db,
    athleteId,
    { kind: 'race', distanceMeters: best.distanceMeters, timeSeconds: best.durationSeconds },
    { today: opts.today, source: 'auto' },
  );
  return { vdot: res.vdot, source: 'auto' };
}
