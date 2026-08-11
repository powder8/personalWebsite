/**
 * DB glue for two-level CYCLING power customization: load the global power model
 * + an athlete's overrides and resolve effective PowerZones. The power-side twin
 * of db/paceConfig.ts. Used by cycling plan generation and the console's
 * engine-params editor.
 */
import { eq } from 'drizzle-orm';
import type { DB } from './client';
import { athletes, engineSettings } from './schema';
import {
  resolveFtp,
  resolvePowerZones,
  DEFAULT_GLOBAL_POWER_MODEL,
  type GlobalPowerModel,
  type AthletePowerConfig,
  type PowerZones,
} from '@/engine/plan';

/**
 * The athlete's FTP taken DIRECTLY from their fitness anchor (explicit FTP or a
 * test), never re-derived from the resolved power zones — those carry tweaks
 * (bias, overrides) that must not move the fitness number. Mirrors
 * getAthleteVdot. Returns null when no FTP anchor is configured (an HR-only
 * athlete has no FTP; use getAthletePowerZones for their %LTHR zones).
 */
export async function getAthleteFtp(db: DB, athleteId: string): Promise<number | null> {
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return null;
  const cfg = (athlete.powerConfig as AthletePowerConfig | null) ?? {};
  const global = await getGlobalPowerModel(db);
  return resolveFtp(cfg, global);
}

export async function getGlobalPowerModel(db: DB): Promise<GlobalPowerModel> {
  const [row] = await db.select().from(engineSettings).where(eq(engineSettings.id, 'global')).limit(1);
  return (row?.powerModel as GlobalPowerModel | null) ?? DEFAULT_GLOBAL_POWER_MODEL;
}

export async function setGlobalPowerModel(db: DB, model: GlobalPowerModel): Promise<void> {
  await db
    .insert(engineSettings)
    .values({ id: 'global', powerModel: model, updatedAt: new Date() })
    .onConflictDoUpdate({ target: engineSettings.id, set: { powerModel: model, updatedAt: new Date() } });
}

export async function setAthletePowerConfig(
  db: DB,
  athleteId: string,
  config: AthletePowerConfig,
): Promise<void> {
  await db
    .update(athletes)
    .set({ powerConfig: config, updatedAt: new Date() })
    .where(eq(athletes.id, athleteId));
}

/**
 * Effective cycling zones for an athlete = global power model + their
 * powerConfig. Returns %FTP watt zones when an FTP anchor exists, %LTHR HR zones
 * when only LTHR is set, or null when no anchor can be determined. Mirrors
 * getAthleteZones.
 */
export async function getAthletePowerZones(db: DB, athleteId: string): Promise<PowerZones | null> {
  const global = await getGlobalPowerModel(db);
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return null;
  const cfg = (athlete.powerConfig as AthletePowerConfig | null) ?? {};
  try {
    return resolvePowerZones(cfg, global);
  } catch {
    return null; // no usable anchor (no FTP, no LTHR)
  }
}
