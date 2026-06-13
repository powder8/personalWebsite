import 'server-only';
/**
 * Missed-day adaptation: reads the athlete's recent planned-vs-actual adherence
 * and produces an encouragement + (for a real layoff) an in-place ease-back.
 * Thin wrapper over the pure analyzer in adaptationLogic.ts.
 */
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { activities } from '@/db/schema';
import { getComplianceWeeks } from '@/server/compliance';
import { listActiveDirectives } from '@/server/directives';
import { analyzeAdherence, type AdaptationState, type AdherenceDay } from '@/server/adaptationLogic';

export type { AdaptationState } from '@/server/adaptationLogic';

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export async function getAdaptationState(athleteId: string, today: string): Promise<AdaptationState | null> {
  const db = await getDb();
  // Last actual run from ALL activities (not just plan-week days) — the honest
  // layoff signal. If they've never run, we can't assess; don't nag.
  const [latest] = await db
    .select({ startTime: activities.startTime })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), eq(activities.sport, 'run')))
    .orderBy(desc(activities.startTime))
    .limit(1);
  const lastRunDay = latest?.startTime ? latest.startTime.toISOString().slice(0, 10) : null;
  if (!lastRunDay) return null;

  // Per-day adherence within the published plan, last 2 weeks → streak/misses.
  const report = await getComplianceWeeks(athleteId, today, 3);
  const windowStart = addDays(today, -14);
  const days: AdherenceDay[] = report.weeks
    .flatMap((w) => w.days)
    .filter((d) => d.day >= windowStart && d.day <= today)
    .map((d) => ({ day: d.day, status: d.status, actualMiles: d.actualMiles, sessionType: d.sessionType }));

  // Need at least one past planned day OR a genuine layoff to say anything.
  if (days.filter((d) => d.day < today).length === 0 && addDaysDiff(lastRunDay, today) < 4) return null;

  const state = analyzeAdherence({ today, days, lastRunDay });
  if (!state) return null;

  // Did the athlete already tap "ease me back in"? If a windowed ease-back
  // directive is active over today, flip the card to its confirmation state so
  // it stops re-prompting (the layoff signal alone can't tell us they acted).
  const active = await listActiveDirectives(db, athleteId);
  state.easeBackApplied = active.some(
    (d) => d.type === 'reduce_volume' && /easing back/i.test(d.label ?? '') && d.from <= today && (d.to == null || d.to >= today),
  );
  return state;
}

function addDaysDiff(from: string, to: string): number {
  const [ay, am, ad] = from.split('-').map(Number);
  const [by, bm, bd] = to.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** Directive payloads for the "ease me back in" action (windowed, dates unchanged). */
export function easeBackDirectives(
  state: AdaptationState,
  today: string,
): { type: 'reduce_volume' | 'pace_adjust'; from: string; to: string; factor?: number; deltaSecPerMile?: number; label: string }[] {
  if (!state.easeBack) return [];
  const to = addDays(today, state.easeBack.days);
  const out: ReturnType<typeof easeBackDirectives> = [
    { type: 'reduce_volume', from: today, to, factor: state.easeBack.factor, label: 'Easing back in after time off' },
  ];
  if (state.easeBack.paceEaseSecPerMile) {
    out.push({
      type: 'pace_adjust',
      from: today,
      to,
      deltaSecPerMile: state.easeBack.paceEaseSecPerMile,
      label: 'Easier paces while ramping back',
    });
  }
  return out;
}
