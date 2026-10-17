/**
 * Keep the cycling FTP current from the athlete's own rides — the bike twin of
 * ensureAutoAnchor. Runs after a Strava sync/webhook: if there is new ride
 * power, estimate FTP (best 20 min × 0.95) and, when ftpAnchorLogic agrees,
 * update the anchor and re-tune future rides. Throttled so it costs Strava
 * calls only when a new ride could change the answer.
 */
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { DB } from '@/db';
import { activities, athletes } from '@/db/schema';
import { getAthleteFtp, setAthletePowerConfig } from '@/db/powerConfig';
import type { AthletePowerConfig } from '@/engine/plan';
import { setAthleteFtp } from './bikeAdjust';
import { estimateFtpFromStrava } from './strava';
import { decideFtpUpdate, ftpOrigin, shouldCheckFtp, type FtpEstimate } from './ftpAnchorLogic';

/** The window estimateFtpFromStrava looks at. */
const RIDE_WINDOW_DAYS = 120;

export type FtpEstimator = (db: DB, athleteId: string) => Promise<FtpEstimate | null>;

export interface AutoFtpResult {
  status: 'skipped' | 'unchanged' | 'updated';
  ftpWatts: number | null;
  previousFtp?: number | null;
  updatedSessions?: number;
  reason: string;
}

export async function ensureAutoFtp(
  db: DB,
  athleteId: string,
  opts: { today: string; now?: Date; estimate?: FtpEstimator },
): Promise<AutoFtpResult> {
  const now = opts.now ?? new Date();
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) return { status: 'skipped', ftpWatts: null, reason: 'no athlete' };
  const cfg: AthletePowerConfig = (athlete.powerConfig as AthletePowerConfig | null) ?? {};
  const currentFtp = await getAthleteFtp(db, athleteId);

  // Only a ride long enough to contain a 20-min effort can move the estimate.
  const since = new Date(now.getTime() - RIDE_WINDOW_DAYS * 86400000);
  const [latest] = await db
    .select({ startTime: activities.startTime })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), eq(activities.sport, 'bike'), gte(activities.startTime, since), gte(activities.durationSeconds, 20 * 60), inArray(activities.provider, ['strava', 'garmin'])))
    .orderBy(desc(activities.startTime))
    .limit(1);

  if (!shouldCheckFtp({ lastCheckedAt: cfg.autoFtpCheckedAt ?? null, latestRideStart: latest?.startTime ?? null, now })) {
    return { status: 'skipped', ftpWatts: currentFtp, reason: latest ? 'no new rides since the last check' : 'no recent rides' };
  }

  // A failed estimate (rate limit, Strava down) is NOT recorded as a check, so
  // the next sync tries again.
  const estimate = await (opts.estimate ?? estimateFtpFromStrava)(db, athleteId);
  const decision = decideFtpUpdate({
    currentFtp,
    origin: ftpOrigin(cfg),
    autonomous: athlete.coachingMode === 'autonomous',
    estimate,
  });
  const checkedAt = now.toISOString();

  if (!decision.set || !estimate) {
    await setAthletePowerConfig(db, athleteId, { ...cfg, autoFtpCheckedAt: checkedAt });
    return { status: 'unchanged', ftpWatts: currentFtp, reason: decision.reason };
  }

  const res = await setAthleteFtp(db, athleteId, estimate.ftpWatts, {
    today: opts.today,
    source: 'auto',
    extra: {
      ftpBasis: 'rides',
      ftpEstimate: { confidence: estimate.confidence, sampleSize: estimate.sampleSize, on: opts.today },
      autoFtpCheckedAt: checkedAt,
    },
  });
  return { status: 'updated', ftpWatts: res.ftpWatts, previousFtp: currentFtp, updatedSessions: res.updatedSessions, reason: decision.reason };
}

export interface FtpProvenance {
  origin: 'starter' | 'rides' | 'manual';
  /** When the rides last set it (YYYY-MM-DD) and how many rides were behind it. */
  estimate: { on: string; sampleSize: number; confidence: 'high' | 'medium' | 'low' } | null;
}

export async function getFtpProvenance(db: DB, athleteId: string): Promise<FtpProvenance> {
  const [athlete] = await db.select({ powerConfig: athletes.powerConfig }).from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  const cfg: AthletePowerConfig = (athlete?.powerConfig as AthletePowerConfig | null) ?? {};
  const origin = ftpOrigin(cfg);
  return { origin, estimate: origin === 'rides' ? cfg.ftpEstimate ?? null : null };
}

/**
 * Hand the FTP back to the rides: the current number becomes a starting point
 * that the next ride estimate replaces (up or down), and the next sync checks
 * immediately. The undo for "I typed Garmin's number in once".
 */
export async function trackFtpFromRides(db: DB, athleteId: string): Promise<void> {
  const [athlete] = await db.select({ powerConfig: athletes.powerConfig }).from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  if (!athlete) throw new Error('Athlete not found.');
  const cfg: AthletePowerConfig = { ...((athlete.powerConfig as AthletePowerConfig | null) ?? {}) };
  cfg.anchorSource = 'auto';
  cfg.ftpBasis = 'starter';
  delete cfg.ftpEstimate;
  delete cfg.autoFtpCheckedAt;
  await setAthletePowerConfig(db, athleteId, cfg);
}
