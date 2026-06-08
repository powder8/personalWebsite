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
import { and, desc, eq, gte, lte, like } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes, activities } from '@/db/schema';
import { vdotFromRace, STANDARD_DISTANCES, type AthletePaceConfig } from '@/engine/plan';
import {
  getAthleteZones,
  getAthleteVdot,
  setAthletePaceConfig,
} from '@/db/paceConfig';
import { reapplyZonesToFuturePlan } from '@/server/paceAdjust';
import { vdotCeiling, isCorroborated, isRaceEffort, type Effort } from '@/server/perf';

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
  paceLabel: string; // min/mi
  vdot: number;
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
  opts: { days?: number; limit?: number } = {},
): Promise<AnchorCandidate[]> {
  // Wide enough to catch a recent goal race (a marathon block can be months
  // back), while still recent enough to reflect current fitness.
  const { days = 270, limit = 3 } = opts;

  const [latest] = await db
    .select({ startTime: activities.startTime })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), eq(activities.sport, 'run')))
    .orderBy(desc(activities.startTime))
    .limit(1);
  if (!latest?.startTime) return [];

  const cutoff = new Date(latest.startTime.getTime() - days * 86400000);
  const rows = await db
    .select({
      startTime: activities.startTime,
      name: activities.name,
      workoutType: activities.workoutType,
      distanceMeters: activities.distanceMeters,
      durationSeconds: activities.durationSeconds,
    })
    .from(activities)
    .where(
      and(
        eq(activities.athleteId, athleteId),
        eq(activities.sport, 'run'),
        gte(activities.startTime, cutoff),
        lte(activities.startTime, latest.startTime),
        like(activities.sourceRef, 'strava:%'),
      ),
    );

  const scored: (AnchorCandidate & { ts: number; rawVdot: number; isRace: boolean })[] = [];
  for (const r of rows) {
    const m = r.distanceMeters ?? 0;
    const t = r.durationSeconds ?? 0;
    if (m < MIN_M || t <= 0) continue;
    const isRace = isRaceEffort({ workoutType: r.workoutType, name: r.name, meters: m });
    // Easy long runs (non-race, > half-marathon) under-estimate fitness, so skip
    // them — but a marathon RACE is a valid, important anchor.
    if (!isRace && m > MAX_M) continue;
    const raw = vdotFromRace({ distanceMeters: m, timeSeconds: t });
    if (!Number.isFinite(raw) || raw < 20 || raw > 90) continue;
    scored.push({
      day: r.startTime.toISOString().slice(0, 10),
      name: r.name,
      distanceMeters: m,
      durationSeconds: t,
      distanceLabel: nearestStandard(m),
      timeLabel: fmtTime(t),
      paceLabel: paceMinPerMile(m, t),
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
 * Default the anchor to our best belief from activity history — UNLESS a human
 * has set it ('manual'). Safe to call after every import: it keeps an auto
 * anchor fresh as new efforts come in, and never overrides a coach's choice.
 * Returns the candidate used (or null if none / left manual).
 */
export async function ensureAutoAnchor(
  db: DB,
  athleteId: string,
  opts: { today: string },
): Promise<{ vdot: number | null; source: 'auto' | 'manual' | 'none' }> {
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return { vdot: null, source: 'none' };
  const cfg = (athlete.paceConfig as AthletePaceConfig | null) ?? {};
  if (cfg.anchorSource === 'manual') {
    const v = await getAthleteVdot(db, athleteId);
    return { vdot: v != null ? Math.round(v * 10) / 10 : null, source: 'manual' };
  }
  const [best] = await suggestAnchorCandidates(db, athleteId, { limit: 1 });
  if (!best) return { vdot: null, source: 'none' };
  const res = await setAnchor(
    db,
    athleteId,
    { kind: 'race', distanceMeters: best.distanceMeters, timeSeconds: best.durationSeconds },
    { today: opts.today, source: 'auto' },
  );
  return { vdot: res.vdot, source: 'auto' };
}
