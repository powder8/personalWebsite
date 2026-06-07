/**
 * Per-athlete pace adjustment — the "adjust the individual's model" loop.
 *
 * A coach nudges one or more pace zones (in sec/mile). We:
 *  1. merge the nudge into the athlete's paceConfig.zoneOverrides (their model),
 *  2. record an Override (labeled training data; reason inferred from direction),
 *  3. re-apply the new zones to FUTURE planned sessions (so the paces they saw
 *     as "off" are corrected everywhere — pinned sessions are left untouched).
 *
 * This is exactly "interventions edit engine inputs, not outputs": the change
 * lands on the athlete's model, and the plan is re-derived from it.
 */
import { and, eq, gte, inArray } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes, plans, plannedSessions, overrides } from '@/db/schema';
import { getAthleteZones, setAthletePaceConfig } from '@/db/paceConfig';
import {
  midpoint,
  type AthletePaceConfig,
  type ZoneKey,
  type PaceZones,
} from '@/engine/plan';

const MI_TO_KM = 1.609344;
const ZONE_KEYS: ZoneKey[] = [
  'recovery',
  'easy',
  'maintenance',
  'marathon',
  'threshold',
  'interval',
  'rep',
];

export interface PaceAdjustResult {
  updatedSessions: number;
  reasonCode: string;
}

export async function adjustAthleteZones(
  db: DB,
  athleteId: string,
  deltasSecPerMile: Partial<Record<ZoneKey, number>>,
  opts: { today: string; createdBy?: string },
): Promise<PaceAdjustResult> {
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) throw new Error(`adjustAthleteZones: athlete ${athleteId} not found`);

  const before = await getAthleteZones(db, athleteId);

  // Merge nudges (accumulate) into the athlete's zone overrides.
  const cfg: AthletePaceConfig = { ...((athlete.paceConfig as AthletePaceConfig | null) ?? {}) };
  const zoneOverrides = { ...(cfg.zoneOverrides ?? {}) };
  let netDeltaMi = 0;
  for (const k of ZONE_KEYS) {
    const dMi = deltasSecPerMile[k];
    if (!dMi || !Number.isFinite(dMi)) continue;
    netDeltaMi += dMi;
    const dKm = dMi / MI_TO_KM; // positive = slower
    const cur = zoneOverrides[k] ?? {};
    zoneOverrides[k] = {
      ...cur,
      fastAdjust: (cur.fastAdjust ?? 0) + dKm,
      slowAdjust: (cur.slowAdjust ?? 0) + dKm,
    };
  }
  cfg.zoneOverrides = zoneOverrides;
  await setAthletePaceConfig(db, athleteId, cfg);

  const after = await getAthleteZones(db, athleteId);

  // Labeled data: slowing paces ⇒ coach felt it was too aggressive, and vice versa.
  const reasonCode = netDeltaMi > 0 ? 'too_aggressive' : netDeltaMi < 0 ? 'too_cautious' : 'other';
  await db.insert(overrides).values({
    athleteId,
    targetType: 'pace_model',
    before: snapshot(before),
    after: snapshot(after),
    reasonCode: reasonCode as 'too_aggressive' | 'too_cautious' | 'other',
    note: summarize(deltasSecPerMile),
    createdBy: opts.createdBy ?? 'coach',
  });

  const updatedSessions = after ? await reapplyZonesToFuturePlan(db, athleteId, opts.today, after) : 0;
  return { updatedSessions, reasonCode };
}

/** Set the athlete's endurance↔speed strength bias and re-apply to future sessions. */
export async function setStrengthBias(
  db: DB,
  athleteId: string,
  bias: number,
  opts: { today: string },
): Promise<{ updatedSessions: number }> {
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) throw new Error(`setStrengthBias: athlete ${athleteId} not found`);
  const cfg: AthletePaceConfig = { ...((athlete.paceConfig as AthletePaceConfig | null) ?? {}) };
  cfg.strengthBias = Math.max(-1, Math.min(1, bias));
  await setAthletePaceConfig(db, athleteId, cfg);
  const zones = await getAthleteZones(db, athleteId);
  const updatedSessions = zones ? await reapplyZonesToFuturePlan(db, athleteId, opts.today, zones) : 0;
  return { updatedSessions };
}

/** Recompute future sessions' pace bounds from zones. Skips pinned + zoneless. */
export async function reapplyZonesToFuturePlan(
  db: DB,
  athleteId: string,
  today: string,
  zones: PaceZones,
): Promise<number> {
  const futurePlans = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.athleteId, athleteId), gte(plans.weekEnd, today)));
  const planIds = futurePlans.map((p) => p.id);
  if (planIds.length === 0) return 0;

  const sessions = await db
    .select()
    .from(plannedSessions)
    .where(inArray(plannedSessions.planId, planIds));

  let n = 0;
  for (const s of sessions) {
    if (s.pinned || !s.zone) continue; // respect coach pins; skip rest/cross-train
    const z = zones.zones[s.zone as ZoneKey];
    if (!z) continue;
    await db
      .update(plannedSessions)
      .set({
        targetPaceFastSecPerKm: z.fastSecPerKm,
        targetPaceSlowSecPerKm: z.slowSecPerKm,
        targetPaceSecPerKm: midpoint(z),
      })
      .where(eq(plannedSessions.id, s.id));
    n++;
  }
  return n;
}

function snapshot(zones: PaceZones | null): object {
  if (!zones) return {};
  const out: Record<string, number> = {};
  for (const k of ZONE_KEYS) out[k] = Math.round(midpoint(zones.zones[k]));
  return out;
}

function summarize(deltas: Partial<Record<ZoneKey, number>>): string {
  const parts = ZONE_KEYS.filter((k) => deltas[k]).map(
    (k) => `${k} ${deltas[k]! > 0 ? '+' : ''}${deltas[k]}s/mi`,
  );
  return parts.length ? `Pace model adjusted: ${parts.join(', ')}` : 'Pace model adjusted';
}
