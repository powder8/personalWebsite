/**
 * PURE auto-FTP decisions (no I/O) — the bike twin of anchorLogic. After a
 * Strava sync we estimate FTP from the athlete's own ride power (best 20-min
 * × 0.95 over ~4 months) and decide whether it should replace the current
 * anchor, so the plan keeps adjusting as the rider's numbers change.
 */
import type { AthletePowerConfig } from '@/engine/plan';

export interface FtpEstimate {
  ftpWatts: number;
  confidence: 'high' | 'medium' | 'low';
  sampleSize: number;
}

/** Ignore moves smaller than this share of the current FTP (no churn). */
export const FTP_CHURN_PCT = 0.02;
/** A manual FTP is overridden only by a clearly stronger demonstrated one (autonomous athletes). */
export const FTP_MANUAL_UPGRADE_PCT = 0.05;
/** Lowering an auto FTP needs this much of a drop… */
export const FTP_LOWER_PCT = 0.05;

export type FtpOrigin = 'starter' | 'rides' | 'manual';

/**
 * Where the current FTP came from. Unset provenance is treated as MANUAL: the
 * only auto-tagged FTPs before this existed are body-mass starter guesses, and
 * an untagged one was typed in (bike goal setup), so never overwrite it.
 */
export function ftpOrigin(cfg: Pick<AthletePowerConfig, 'anchorSource' | 'ftpBasis'>): FtpOrigin {
  if (cfg.ftpBasis === 'manual' || cfg.anchorSource === 'manual') return 'manual';
  if (cfg.anchorSource === 'auto') return cfg.ftpBasis === 'rides' ? 'rides' : 'starter';
  return 'manual';
}

export interface FtpDecisionInput {
  currentFtp: number | null;
  origin: FtpOrigin;
  autonomous: boolean;
  estimate: FtpEstimate | null;
}

export function decideFtpUpdate(i: FtpDecisionInput): { set: boolean; reason: string } {
  const est = i.estimate;
  if (!est || !(est.ftpWatts > 0)) return { set: false, reason: 'no ride power to estimate from' };
  if (i.currentFtp == null) return { set: true, reason: 'no FTP yet: use the demonstrated one' };

  const delta = (est.ftpWatts - i.currentFtp) / i.currentFtp;

  if (i.origin === 'manual') {
    if (i.autonomous && est.confidence !== 'low' && delta >= FTP_MANUAL_UPGRADE_PCT) {
      return { set: true, reason: 'self-coached: rides clearly beat the entered FTP' };
    }
    return { set: false, reason: 'respecting the entered FTP' };
  }

  // A starter guess yields to ANY demonstrated power, up or down.
  if (i.origin === 'starter') return { set: true, reason: 'replacing the starter estimate with ride power' };

  if (Math.abs(delta) < FTP_CHURN_PCT) return { set: false, reason: 'already at ~this FTP' };
  if (delta > 0) return { set: true, reason: 'rides show a higher FTP' };
  // Going down: best-20 over a window drops when a big ride ages out, or when
  // recent riding was all easy. Only follow it with several rides behind it.
  if (est.confidence === 'high' && -delta >= FTP_LOWER_PCT) return { set: true, reason: 'several recent rides show a lower FTP' };
  return { set: false, reason: 'a lower estimate without enough rides behind it' };
}

/** Recheck at least this often, so an aged-out best effort is noticed. */
export const FTP_RECHECK_DAYS = 14;

/**
 * Whether to spend Strava calls on an FTP estimate now: there is a recent
 * ride long enough to hold a 20-min effort, and either we never checked, a
 * ride landed since the last check, or the last check is stale.
 */
export function shouldCheckFtp(i: { lastCheckedAt: string | null; latestRideStart: Date | null; now: Date }): boolean {
  if (!i.latestRideStart) return false;
  if (!i.lastCheckedAt) return true;
  const last = Date.parse(i.lastCheckedAt);
  if (!Number.isFinite(last)) return true;
  if (i.latestRideStart.getTime() > last) return true;
  return i.now.getTime() - last > FTP_RECHECK_DAYS * 86400000;
}
