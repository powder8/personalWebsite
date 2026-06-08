/**
 * DB glue for two-level pace customization: load the global model + an athlete's
 * overrides and resolve effective PaceZones. Used by plan generation and the
 * console's engine-params editor.
 */
import { eq } from 'drizzle-orm';
import type { DB } from './client';
import { athletes, intakeProfiles, engineSettings } from './schema';
import {
  resolvePaceZones,
  vdotFromRace,
  vdotFromThreshold,
  DEFAULT_GLOBAL_MODEL,
  type GlobalPaceModel,
  type AthletePaceConfig,
  type PaceZones,
} from '@/engine/plan';

/**
 * The athlete's VDOT taken DIRECTLY from their fitness anchor (race / explicit
 * VDOT / threshold), with an intake-threshold fallback. Not re-derived from the
 * resolved training-pace zones — those carry tweaks (bias, overrides) that must
 * not move the fitness number, and the threshold→VDOT round-trip loses ~2%.
 */
export async function getAthleteVdot(db: DB, athleteId: string): Promise<number | null> {
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return null;
  const cfg = (athlete.paceConfig as AthletePaceConfig | null) ?? {};
  if (cfg.vdot != null) return cfg.vdot;
  if (cfg.race) return vdotFromRace(cfg.race);
  if (cfg.thresholdSecPerKm != null) return vdotFromThreshold(cfg.thresholdSecPerKm);

  const [intake] = await db
    .select()
    .from(intakeProfiles)
    .where(eq(intakeProfiles.athleteId, athleteId))
    .limit(1);
  const t = (intake?.answers as { thresholdSecPerKm?: number } | null)?.thresholdSecPerKm;
  return t != null ? vdotFromThreshold(t) : null;
}

export async function getGlobalPaceModel(db: DB): Promise<GlobalPaceModel> {
  const [row] = await db.select().from(engineSettings).where(eq(engineSettings.id, 'global')).limit(1);
  return (row?.paceModel as GlobalPaceModel | null) ?? DEFAULT_GLOBAL_MODEL;
}

export async function setGlobalPaceModel(db: DB, model: GlobalPaceModel): Promise<void> {
  await db
    .insert(engineSettings)
    .values({ id: 'global', paceModel: model, updatedAt: new Date() })
    .onConflictDoUpdate({ target: engineSettings.id, set: { paceModel: model, updatedAt: new Date() } });
}

export async function setAthletePaceConfig(
  db: DB,
  athleteId: string,
  config: AthletePaceConfig,
): Promise<void> {
  await db
    .update(athletes)
    .set({ paceConfig: config, updatedAt: new Date() })
    .where(eq(athletes.id, athleteId));
}

/**
 * Effective zones for an athlete = global model + their paceConfig, with a
 * fitness anchor pulled from intake (thresholdSecPerKm) when paceConfig omits
 * one. Returns null if no anchor can be determined.
 */
export async function getAthleteZones(db: DB, athleteId: string): Promise<PaceZones | null> {
  const global = await getGlobalPaceModel(db);

  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return null;
  const cfg: AthletePaceConfig = { ...((athlete.paceConfig as AthletePaceConfig | null) ?? {}) };

  // Fall back to the intake threshold as the anchor if none is configured.
  if (cfg.vdot == null && cfg.thresholdSecPerKm == null && cfg.race == null) {
    const [intake] = await db
      .select()
      .from(intakeProfiles)
      .where(eq(intakeProfiles.athleteId, athleteId))
      .limit(1);
    const t = (intake?.answers as { thresholdSecPerKm?: number } | null)?.thresholdSecPerKm;
    if (t != null) cfg.thresholdSecPerKm = t;
  }

  try {
    return resolvePaceZones(cfg, global);
  } catch {
    return null; // no usable anchor
  }
}
