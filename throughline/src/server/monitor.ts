import 'server-only';
/**
 * The proactive "monitor & adapt" pass. Runs daily (cron) for every active
 * athlete:
 *
 *  1. pull fresh wearable data (webhooks get missed);
 *  2. refresh body status: detect illness / overreaching / under-recovery
 *     against the healthy baseline, advance any open episode, rewrite the
 *     plan's automatic adjustments, and alert the athlete to anything new;
 *  3. ease back in after missed days, unless the body status is already
 *     managing the return.
 *
 * Autonomy: AUTONOMOUS athletes get changes applied; ASSISTED athletes get
 * fatigue adjustments as coach PROPOSALS. Illness holds and injury pauses apply
 * in both modes: safety never waits on a human.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { athletes } from '@/db/schema';
import { todayForTimezone } from '@/lib/today';
import { getAdaptationState } from '@/server/adaptation';
import { createDirective, clearAutoDirectives } from '@/server/directives';
import { addDaysISO } from '@/server/monitorLogic';
import { evaluateBodyStatus } from '@/server/bodyStatus';
import { refreshAthleteHealth } from '@/server/healthRefresh';
import { getWhoopAccount, syncWhoopData } from '@/server/whoop';

export interface MonitorResult {
  scanned: number;
  applied: number; // adaptations applied (autonomous)
  proposed: number; // adaptations proposed (assisted)
  alerted: number; // athletes told about a new body-status change
  details: { athlete: string; action: string; mode: string }[];
}

/** Body states that already hold training back: don't stack a layoff ease on top. */
const MANAGED = new Set(['illness_suspected', 'ill', 'returning', 'overreaching', 'under_recovered', 'strained']);

export async function runMonitor(opts: { dryRun?: boolean } = {}): Promise<MonitorResult> {
  const db = await getDb();
  const roster = await db
    .select({ id: athletes.id, name: athletes.fullName, mode: athletes.coachingMode, tz: athletes.timezone })
    .from(athletes)
    .where(eq(athletes.active, true));

  const result: MonitorResult = { scanned: roster.length, applied: 0, proposed: 0, alerted: 0, details: [] };

  for (const a of roster) {
    const today = todayForTimezone(a.tz);
    const proposed = a.mode === 'assisted';
    try {
      // --- 1. Fresh wearable data ---
      if (!opts.dryRun && (await getWhoopAccount(db, a.id))) {
        await syncWhoopData(db, a.id, 3).catch(() => undefined);
      }

      // --- 2. Body status ---
      let status: string | null = null;
      if (opts.dryRun) {
        status = (await evaluateBodyStatus(db, a.id, today))?.view.status ?? null;
      } else {
        // The old band-counting ease is superseded by body status.
        await clearAutoDirectives(db, a.id, 'low_recovery');
        const health = await refreshAthleteHealth(db, a.id, today, { notify: true });
        status = health.body?.status ?? null;
        if (health.alerted) result.alerted++;
        if (health.body?.planChanged) tally(result, proposed && !['ill', 'illness_suspected', 'returning'].includes(status ?? ''), a.name, `body status: ${status}`, a.mode);
      }
      if (opts.dryRun && status && MANAGED.has(status)) result.details.push({ athlete: a.name, action: `would manage: ${status}`, mode: a.mode });

      // --- 3. Missed days / layoff ---
      if (!opts.dryRun) await clearAutoDirectives(db, a.id, 'missed_days');
      if (status && MANAGED.has(status)) continue; // the body-status plan already governs the return
      const adaptation = await getAdaptationState(a.id, today);
      if (adaptation?.easeBack && !adaptation.easeBackApplied) {
        const eb = adaptation.easeBack;
        const label = `Auto-eased after ${adaptation.layoffDays} days off, trimmed ~${Math.round((1 - eb.factor) * 100)}% so the return feels good, not brutal.`;
        if (!opts.dryRun) {
          await createDirective(db, a.id, { type: 'reduce_volume', factor: eb.factor, from: today, to: addDaysISO(today, eb.days), label, source: 'auto', category: 'missed_days', proposed });
          if (eb.paceEaseSecPerMile) {
            await createDirective(db, a.id, {
              type: 'pace_adjust',
              deltaSecPerMile: eb.paceEaseSecPerMile,
              from: today,
              to: addDaysISO(today, eb.days),
              label: 'Easing paces while you rebuild',
              source: 'auto',
              category: 'missed_days',
              proposed,
            });
          }
        }
        tally(result, proposed, a.name, `ease-back (${adaptation.layoffDays}d off)`, a.mode);
      }
    } catch (e) {
      // One athlete's failure must not stop the rest of the roster.
      console.error('[monitor]', a.id, e instanceof Error ? e.message : e);
      result.details.push({ athlete: a.name, action: 'error', mode: a.mode });
    }
  }
  return result;
}

function tally(result: MonitorResult, proposed: boolean, athlete: string, action: string, mode: string) {
  if (proposed) result.proposed++;
  else result.applied++;
  result.details.push({ athlete, action: `${proposed ? 'proposed' : 'applied'}: ${action}`, mode });
}
