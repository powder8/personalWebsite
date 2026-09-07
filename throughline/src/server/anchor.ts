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
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes } from '@/db/schema';
import { type AthletePaceConfig } from '@/engine/plan';
import {
  getAthleteZones,
  getAthleteVdot,
  setAthletePaceConfig,
} from '@/db/paceConfig';
import { reapplyZonesToFuturePlan } from '@/server/paceAdjust';
import { decideAnchorUpdate } from '@/server/anchorLogic';
import { scoredRunEfforts, type AnchorCandidate } from '@/server/runEfforts';

// Re-exported so existing callers keep importing these from '@/server/anchor'.
export { scoredRunEfforts } from '@/server/runEfforts';
export type { AnchorCandidate, ScoredRunEffort } from '@/server/runEfforts';

// A demonstrated effort older than this no longer reflects current fitness, so
// it won't auto-anchor (an old PR shouldn't drive today's paces).
const ANCHOR_RELEVANCE_DAYS = 180;
// VDOT gap a recent race must clear to override a human-set anchor (autonomous).
const ANCHOR_UPGRADE_DELTA = 2.0;



/**
 * Best recent run efforts as anchor candidates: the scored efforts, ranked and
 * de-duped so the list offers genuinely different options to accept.
 */
export async function suggestAnchorCandidates(
  db: DB,
  athleteId: string,
  opts: { days?: number; limit?: number; sinceDay?: string } = {},
): Promise<AnchorCandidate[]> {
  const { limit = 3 } = opts;
  const guarded = await scoredRunEfforts(db, athleteId, opts);
  // Prefer trusted efforts (race or hard-HR, most representative), then by VDOT,
  // then recency — so a real peak effort anchors over a noisy training run.
  guarded.sort(
    (a, b) => Number(b.trusted) - Number(a.trusted) || b.vdot - a.vdot || b.day.localeCompare(a.day),
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
