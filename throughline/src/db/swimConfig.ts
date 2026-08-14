/**
 * DB glue for two-level SWIM customization: load the global swim model + an
 * athlete's overrides and resolve effective SwimZones / the CSS anchor. The
 * swim-side twin of db/powerConfig.ts and db/paceConfig.ts.
 *
 * `getAthleteCss` is the single wire that finally populates
 * `LoadAnchors.cssMetersPerSec` at the load-computation call site
 * (db/loadCurrencyConfig.ts:resolveAthleteLoadAnchors), turning swim load from
 * `estimated` into `css` confidence — the swim analog of how getAthleteFtp feeds
 * `anchors.ftpWatts`.
 *
 * NO `server-only` (mirrors db/powerConfig.ts) so scripts can import the setters.
 */
import { eq } from 'drizzle-orm';
import type { DB } from './client';
import { athletes, engineSettings } from './schema';
import {
  resolveCss,
  resolveSwimZones,
  DEFAULT_GLOBAL_SWIM_MODEL,
  type GlobalSwimModel,
  type AthleteSwimConfig,
  type SwimZones,
} from '@/engine/plan';

/**
 * The athlete's CSS (m/s) taken DIRECTLY from their fitness anchor (explicit CSS
 * or a swim test), never re-derived from the resolved swim zones — those carry
 * tweaks (bias, overrides) that must not move the fitness number. Mirrors
 * getAthleteFtp / getAthleteVdot. Returns null when no CSS anchor is configured
 * (that athlete's swim load falls back to `estimated` — there is no swim HR path).
 */
export async function getAthleteCss(db: DB, athleteId: string): Promise<number | null> {
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return null;
  const cfg = (athlete.swimConfig as AthleteSwimConfig | null) ?? {};
  const global = await getGlobalSwimModel(db);
  return resolveCss(cfg, global);
}

export async function getGlobalSwimModel(db: DB): Promise<GlobalSwimModel> {
  const [row] = await db.select().from(engineSettings).where(eq(engineSettings.id, 'global')).limit(1);
  return (row?.swimModel as GlobalSwimModel | null) ?? DEFAULT_GLOBAL_SWIM_MODEL;
}

export async function setGlobalSwimModel(db: DB, model: GlobalSwimModel): Promise<void> {
  await db
    .insert(engineSettings)
    .values({ id: 'global', swimModel: model, updatedAt: new Date() })
    .onConflictDoUpdate({ target: engineSettings.id, set: { swimModel: model, updatedAt: new Date() } });
}

export async function setAthleteSwimConfig(
  db: DB,
  athleteId: string,
  config: AthleteSwimConfig,
): Promise<void> {
  await db
    .update(athletes)
    .set({ swimConfig: config, updatedAt: new Date() })
    .where(eq(athletes.id, athleteId));
}

/**
 * Effective swim zones for an athlete = global swim model + their swimConfig.
 * Returns CSS-relative sec/100 m zones when a CSS anchor exists, or null when
 * none can be determined (no swim HR fallback). Mirrors getAthletePowerZones.
 */
export async function getAthleteSwimZones(db: DB, athleteId: string): Promise<SwimZones | null> {
  const global = await getGlobalSwimModel(db);
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return null;
  const cfg = (athlete.swimConfig as AthleteSwimConfig | null) ?? {};
  try {
    return resolveSwimZones(cfg, global);
  } catch {
    return null; // no usable anchor (no CSS)
  }
}
