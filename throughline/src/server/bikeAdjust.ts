/**
 * Per-athlete CYCLING re-tuning — the power-side twin of paceAdjust's
 * reapplyZonesToFuturePlan. Bike sessions store BAKED watt bands (a snapshot of
 * the athlete's FTP at generation time), so when the FTP changes the future plan
 * has to be re-derived from the new zones — otherwise the numbers go stale.
 *
 * This is how "the plan keeps adjusting as your numbers change" holds for the
 * bike: update the anchor, re-apply to future rides (pinned sessions untouched).
 */
import { and, eq, gte, inArray } from 'drizzle-orm';
import type { DB } from '@/db';
import { athletes, plans, plannedSessions } from '@/db/schema';
import { getAthletePowerZones, setAthletePowerConfig } from '@/db/powerConfig';
import type { AthletePowerConfig, PowerZones, PowerZoneKey } from '@/engine/plan';

/**
 * Recompute future BIKE sessions' watt bands from the athlete's current power
 * zones. Skips pinned sessions, zoneless rows (rest/cross-train), and the HR-only
 * fallback (no FTP → no watt bands to write). Returns the number of rides re-tuned.
 */
export async function reapplyPowerZonesToFuturePlan(
  db: DB,
  athleteId: string,
  today: string,
  zones: PowerZones,
): Promise<number> {
  if (zones.basis !== 'ftp' || !zones.zones) return 0; // HR-only: nothing to bake in watts

  const futurePlans = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.athleteId, athleteId), gte(plans.weekEnd, today)));
  const planIds = futurePlans.map((p) => p.id);
  if (planIds.length === 0) return 0;

  const sessions = await db.select().from(plannedSessions).where(inArray(plannedSessions.planId, planIds));

  let n = 0;
  for (const s of sessions) {
    if (s.discipline !== 'bike' || s.pinned || !s.zone) continue;
    const band = zones.zones[s.zone as PowerZoneKey];
    if (!band) continue;
    await db
      .update(plannedSessions)
      .set({ targetPowerLowWatts: band.loWatts, targetPowerHighWatts: band.hiWatts })
      .where(eq(plannedSessions.id, s.id));
    n++;
  }
  return n;
}

/**
 * Update the athlete's FTP anchor and re-tune their future rides. The lightweight
 * "my numbers changed" path — no full plan regeneration. Preserves the rest of
 * the power config (weight, target FTP, overrides).
 */
export async function setAthleteFtp(
  db: DB,
  athleteId: string,
  ftpWatts: number,
  opts: { today: string; source?: 'auto' | 'manual' },
): Promise<{ ftpWatts: number; updatedSessions: number }> {
  if (!(ftpWatts > 0)) throw new Error('FTP must be a positive number of watts.');
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) throw new Error(`setAthleteFtp: athlete ${athleteId} not found`);

  const cfg: AthletePowerConfig = { ...((athlete.powerConfig as AthletePowerConfig | null) ?? {}) };
  cfg.ftpWatts = Math.round(ftpWatts);
  // A raw test would otherwise win over the explicit number in resolveFtp; a
  // hand-entered FTP is the intended anchor now.
  delete cfg.ftpTest;
  cfg.anchorSource = opts.source ?? 'manual';
  await setAthletePowerConfig(db, athleteId, cfg);

  const zones = await getAthletePowerZones(db, athleteId);
  const updatedSessions = zones ? await reapplyPowerZonesToFuturePlan(db, athleteId, opts.today, zones) : 0;
  return { ftpWatts: cfg.ftpWatts, updatedSessions };
}
