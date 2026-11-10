/**
 * One call that brings an athlete's health picture up to date: body status
 * (episodes + plan adjustments), then the day's readiness on top of it, then
 * an alert if something new needs the athlete's attention.
 */
import type { DB } from '@/db';
import type { ReadinessResult } from '@/engine';
import { evaluateBodyStatus, markNotified, type BodyStatusView } from './bodyStatus';
import { getRecoveryInsights, persistReadiness, type RecoveryInsights } from './recovery';
import { sendBodyStatusAlert } from './healthAlerts';

/**
 * An episode outranks a single day's score: while the body is fighting
 * something (or coming back from it), today is never a "go" day.
 */
export function applyBodyToReadiness(r: ReadinessResult | null, view: BodyStatusView | null, today: string): ReadinessResult | null {
  if (!view?.forceEasy) return r;
  const sentence = [view.headline, view.planNote].filter(Boolean).join('. ').replace(/\.\./g, '.');
  return {
    day: today,
    score: Math.min(r?.score ?? 35, 35),
    band: 'easy',
    sentence,
    drivers: r?.drivers ?? [],
    sufficientData: r?.sufficientData ?? true,
  };
}

export interface HealthRefresh {
  body: BodyStatusView | null;
  recovery: RecoveryInsights;
  alerted: boolean;
}

export async function refreshAthleteHealth(db: DB, athleteId: string, today: string, opts: { notify?: boolean } = {}): Promise<HealthRefresh> {
  const result = await evaluateBodyStatus(db, athleteId, today, { apply: true });
  const recovery = await getRecoveryInsights(db, athleteId, today, result?.assessment);
  const readiness = applyBodyToReadiness(recovery.readiness, result?.view ?? null, today);
  if (readiness) {
    try {
      await persistReadiness(db, athleteId, readiness);
    } catch {
      /* best-effort */
    }
  }

  let alerted = false;
  if (opts.notify && result?.notifyKey && result.episode) {
    try {
      const sent = await sendBodyStatusAlert(db, athleteId, result.view);
      // Mark as told even with no channel configured: the in-app card covers it,
      // and we must not re-send daily once a channel appears.
      await markNotified(db, result.episode.id, result.notifyKey);
      alerted = sent;
    } catch {
      /* an alert failure must never block the health refresh */
    }
  }
  return { body: result?.view ?? null, recovery: { ...recovery, readiness }, alerted };
}
