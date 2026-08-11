/**
 * DB glue for the load-currency cutover flag + the on-the-fly TSS fallback anchors.
 *
 * The server side of the flag resolved purely by `engine/loadCurrencyFlagLogic.ts`:
 * reads the `engineSettings.loadCurrency` setting and the `LOAD_CURRENCY` env
 * override and returns the effective `'trimp' | 'tss'`. Also resolves an athlete's
 * fitness anchors (threshold pace / FTP / LTHR / sex) used only when the flag is
 * 'tss' and a row's `trainingLoadTss` hasn't been backfilled yet.
 *
 * NO `server-only` (mirrors db/powerConfig.ts) so scripts can import the setter.
 * See docs/multisport/load-currency-transfer-spec.md §2.4.
 */
import { eq } from 'drizzle-orm';
import type { DB } from './client';
import { athletes, engineSettings, intakeProfiles } from './schema';
import { getAthleteVdot } from './paceConfig';
import { getAthleteFtp } from './powerConfig';
import { resolvePaceZones, type AthletePaceConfig } from '@/engine/plan';
import { resolveLoadCurrency, type LoadCurrency } from '@/engine/loadCurrencyFlagLogic';
import type { AthleteLoadAnchors } from '@/engine/loadSelectLogic';

/**
 * The effective load currency for the fitness/fatigue read path. Env
 * `LOAD_CURRENCY` overrides the persisted `engineSettings.loadCurrency` setting,
 * which overrides the default ('trimp'). Unrecognized values fall through.
 */
export async function getLoadCurrency(db: DB): Promise<LoadCurrency> {
  const [row] = await db.select().from(engineSettings).where(eq(engineSettings.id, 'global')).limit(1);
  return resolveLoadCurrency(process.env.LOAD_CURRENCY, row?.loadCurrency ?? null);
}

/**
 * Persist the load-currency setting (the DB flip, story L2). Upserts the single
 * global engine-settings row, exactly like setGlobalPowerModel. The env override,
 * if set, still wins at read time.
 */
export async function setLoadCurrency(db: DB, value: LoadCurrency): Promise<void> {
  await db
    .insert(engineSettings)
    .values({ id: 'global', loadCurrency: value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: engineSettings.id, set: { loadCurrency: value, updatedAt: new Date() } });
}

/** Threshold pace (sec/km) from the athlete's VDOT anchor. Mirrors the backfill script. */
async function resolveThresholdPace(db: DB, athleteId: string): Promise<number | null> {
  const vdot = await getAthleteVdot(db, athleteId);
  if (vdot == null) return null;
  try {
    return resolvePaceZones({ vdot } as AthletePaceConfig).thresholdSecPerKm;
  } catch {
    return null;
  }
}

/**
 * Resolve an athlete's fitness anchors for the on-the-fly TSS fallback. v1 applies
 * the CURRENT anchor to all history (a documented approximation — the PMC is
 * relative; see spec §2.2). Only invoked when currency is 'tss' AND a row lacks a
 * backfilled `trainingLoadTss`, so it's off the hot path in the common case.
 */
export async function resolveAthleteLoadAnchors(db: DB, athleteId: string): Promise<AthleteLoadAnchors> {
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  const thresholdPaceSecPerKm = await resolveThresholdPace(db, athleteId);
  const ftpWatts = await getAthleteFtp(db, athleteId);
  const [intake] = await db
    .select()
    .from(intakeProfiles)
    .where(eq(intakeProfiles.athleteId, athleteId))
    .limit(1);
  const lthrBpm = (intake?.answers as { lthrBpm?: number } | null)?.lthrBpm ?? null;
  return { thresholdPaceSecPerKm, ftpWatts, lthrBpm, sex: athlete?.sex ?? null };
}
