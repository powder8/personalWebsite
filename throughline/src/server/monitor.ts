import 'server-only';
/**
 * The proactive "monitor & adapt" pass. Runs daily (cron) and, for every active
 * athlete, turns SUSTAINED signals into real schedule changes via windowed
 * directives — instead of the plan just sitting there while recovery tanks or
 * days get missed.
 *
 * Autonomy (Peter's call): AUTONOMOUS athletes get the change applied
 * immediately; ASSISTED athletes get it as a PROPOSAL their coach approves.
 * Injury pauses apply in both modes immediately (handled in server/injury.ts —
 * safety never waits on a human).
 *
 * Idempotent: each run clears the monitor's own prior auto directives
 * (low_recovery, missed_days) and rewrites them from today's signals, so the
 * plan always reflects the current state and nothing stacks.
 */
import { and, eq, gte } from 'drizzle-orm';
import { getDb } from '@/db';
import { athletes, readinessAssessments } from '@/db/schema';
import { todayISO } from '@/server/console';
import type { Band } from '@/server/console';
import { getAdaptationState } from '@/server/adaptation';
import { createDirective, clearAutoDirectives } from '@/server/directives';
import { decideRecoveryEase, addDaysISO } from '@/server/monitorLogic';

export interface MonitorResult {
  scanned: number;
  applied: number; // adaptations applied (autonomous)
  proposed: number; // adaptations proposed (assisted)
  details: { athlete: string; action: string; mode: string }[];
}

export async function runMonitor(opts: { dryRun?: boolean } = {}): Promise<MonitorResult> {
  const db = await getDb();
  const today = todayISO();
  const roster = await db
    .select({ id: athletes.id, name: athletes.fullName, mode: athletes.coachingMode })
    .from(athletes)
    .where(eq(athletes.active, true));

  const result: MonitorResult = { scanned: roster.length, applied: 0, proposed: 0, details: [] };

  for (const a of roster) {
    const proposed = a.mode === 'assisted';

    // Clear our own prior adaptations first so signals re-read cleanly and the
    // ease-back "already applied?" check reflects only coach/athlete directives.
    if (!opts.dryRun) {
      await clearAutoDirectives(db, a.id, 'missed_days');
      await clearAutoDirectives(db, a.id, 'low_recovery');
    }

    // --- Missed days / layoff (dominant — an ease-back already trims volume) ---
    const adaptation = await getAdaptationState(a.id, today);
    if (adaptation?.easeBack && !adaptation.easeBackApplied) {
      const eb = adaptation.easeBack;
      const label = `Auto-eased after ${adaptation.layoffDays} days off — trimmed ~${Math.round((1 - eb.factor) * 100)}% so the return feels good, not brutal.`;
      if (!opts.dryRun) {
        await createDirective(db, a.id, {
          type: 'reduce_volume',
          factor: eb.factor,
          from: today,
          to: addDaysISO(today, eb.days),
          label,
          source: 'auto',
          category: 'missed_days',
          proposed,
        });
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
      continue; // layoff ease-back subsumes a recovery trim; don't double-reduce
    }

    // --- Sustained low recovery ---
    const bandRows = await db
      .select({ day: readinessAssessments.day, band: readinessAssessments.band })
      .from(readinessAssessments)
      .where(and(eq(readinessAssessments.athleteId, a.id), gte(readinessAssessments.day, addDaysISO(today, -4))))
      .orderBy(readinessAssessments.day);
    const bands = bandRows.map((r) => (r.band as Band | null) ?? null);
    const ease = decideRecoveryEase(bands);
    if (ease) {
      if (!opts.dryRun) {
        await createDirective(db, a.id, {
          type: 'reduce_volume',
          factor: ease.factor,
          from: today,
          to: addDaysISO(today, ease.days),
          label: ease.reason,
          source: 'auto',
          category: 'low_recovery',
          proposed,
        });
      }
      tally(result, proposed, a.name, 'low-recovery ease', a.mode);
    }
  }

  return result;
}

function tally(result: MonitorResult, proposed: boolean, athlete: string, action: string, mode: string) {
  if (proposed) result.proposed++;
  else result.applied++;
  result.details.push({ athlete, action: `${proposed ? 'proposed' : 'applied'}: ${action}`, mode });
}
