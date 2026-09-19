/**
 * DB glue for two-level CYCLING power customization: load the global power model
 * + an athlete's overrides and resolve effective PowerZones. The power-side twin
 * of db/paceConfig.ts. Used by cycling plan generation and the console's
 * engine-params editor.
 */
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import type { DB } from './client';
import { athletes, engineSettings, dailySummaries } from './schema';
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

/** A scale reading older than this no longer describes today's rider. */
const MEASURED_WEIGHT_MAX_AGE_DAYS = 45;

/**
 * The athlete's body mass (kg) for the bike watts↔speed goal-time model and
 * W/kg. Prefers the most recent MEASURED weight (a connected scale, via Garmin
 * body composition) when it's recent; otherwise the number typed into the power
 * config. Null when neither exists — callers default it.
 */
export async function getAthleteWeightKg(db: DB, athleteId: string): Promise<number | null> {
  const since = new Date(Date.now() - MEASURED_WEIGHT_MAX_AGE_DAYS * 86400000).toISOString().slice(0, 10);
  const [measured] = await db
    .select({ weightKg: dailySummaries.weightKg })
    .from(dailySummaries)
    .where(and(eq(dailySummaries.athleteId, athleteId), isNotNull(dailySummaries.weightKg), gte(dailySummaries.day, since)))
    .orderBy(desc(dailySummaries.day))
    .limit(1);
  if (measured?.weightKg != null && measured.weightKg > 0) return measured.weightKg;

  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return null;
  const cfg = (athlete.powerConfig as AthletePowerConfig | null) ?? {};
  return cfg.weightKg ?? null;
}

/** The athlete's goal FTP (watts), if they've set one — drives the bike goal tracker. */
export async function getAthleteTargetFtp(db: DB, athleteId: string): Promise<number | null> {
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return null;
  const cfg = (athlete.powerConfig as AthletePowerConfig | null) ?? {};
  return cfg.targetFtpWatts ?? null;
}

/** The goal race's total climbing (m), if set — with distance → time feasibility. */
export async function getAthleteGoalElevation(db: DB, athleteId: string): Promise<number | null> {
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return null;
  const cfg = (athlete.powerConfig as AthletePowerConfig | null) ?? {};
  return cfg.goalElevationGainMeters ?? null;
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
