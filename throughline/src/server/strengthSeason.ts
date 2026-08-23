/**
 * Supporting strength scheduler. Strength isn't an endurance discipline — no
 * anchor, no race goal, no periodization. It's a SUPPORTING layer laid at a
 * simple weekly cadence over the athlete's existing plan horizon (durability,
 * injury resistance). Discipline-scoped like the run/bike plans, so it coexists
 * and re-running it only replaces strength.
 *
 * Aligns strength weeks to the athlete's published endurance plan weeks so both
 * render together in the one multisport calendar; falls back to the next 8 weeks
 * when there's no endurance plan yet.
 */
import { and, eq, gte, inArray } from 'drizzle-orm';
import type { DB } from '@/db';
import { plans, plannedSessions } from '@/db/schema';
import { addDays, mondayOf } from '@/server/trainingCalendarLogic';

/** A supporting strength session's default length. */
const STRENGTH_MINUTES = 40;
const FALLBACK_WEEKS = 8;
const ENDURANCE = ['run', 'bike', 'swim'] as const;

/** Weekday placement (0 = Mon … 6 = Sun) by sessions/week — spread through the
 *  week and biased off the hardest endurance days (Tue/Fri for two). */
const PLACEMENT: Record<number, number[]> = {
  1: [2], // Wed
  2: [1, 4], // Tue, Fri
  3: [0, 2, 4], // Mon, Wed, Fri
  4: [0, 1, 3, 4], // Mon, Tue, Thu, Fri
};

export interface StrengthSetupResult {
  daysPerWeek: number;
  weeks: number;
  sessions: number;
}

/** Current supporting-strength cadence (0 when none set), for prefilling the UI. */
export async function getSupportingStrengthDays(db: DB, athleteId: string): Promise<number> {
  const [row] = await db
    .select({ generatedFrom: plans.generatedFrom })
    .from(plans)
    .where(and(eq(plans.athleteId, athleteId), eq(plans.discipline, 'strength')))
    .limit(1);
  const meta = row?.generatedFrom as { daysPerWeek?: number } | null;
  return meta?.daysPerWeek ?? 0;
}

export async function setupSupportingStrength(
  db: DB,
  athleteId: string,
  today: string,
  input: { daysPerWeek: number },
): Promise<StrengthSetupResult> {
  const daysPerWeek = Math.max(0, Math.min(4, Math.round(input.daysPerWeek)));

  // Discipline-scoped: only ever replaces strength, never the endurance plans.
  const existing = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.athleteId, athleteId), eq(plans.discipline, 'strength')));
  if (existing.length) {
    await db.delete(plans).where(inArray(plans.id, existing.map((p) => p.id))); // cascades sessions
  }
  if (daysPerWeek === 0) return { daysPerWeek: 0, weeks: 0, sessions: 0 };

  // Horizon: the athlete's published endurance plan weeks from this week on, so
  // strength lines up with the real plan; otherwise the next 8 weeks.
  const thisMonday = mondayOf(today);
  const enduranceWeeks = await db
    .selectDistinct({ weekStart: plans.weekStart, weekEnd: plans.weekEnd })
    .from(plans)
    .where(and(eq(plans.athleteId, athleteId), eq(plans.status, 'published'), inArray(plans.discipline, ENDURANCE), gte(plans.weekEnd, thisMonday)));

  const weekRows =
    enduranceWeeks.length > 0
      ? enduranceWeeks
      : Array.from({ length: FALLBACK_WEEKS }, (_, i) => {
          const weekStart = addDays(thisMonday, i * 7);
          return { weekStart, weekEnd: addDays(weekStart, 6) };
        });

  const weekdays = PLACEMENT[daysPerWeek] ?? PLACEMENT[2];
  let sessions = 0;
  for (const w of weekRows) {
    const [plan] = await db
      .insert(plans)
      .values({
        athleteId,
        status: 'published',
        discipline: 'strength',
        weekStart: w.weekStart,
        weekEnd: w.weekEnd,
        generatedFrom: { supportingStrength: true, daysPerWeek, setupAt: today },
        publishedAt: new Date(),
      })
      .returning({ id: plans.id });

    const values = weekdays
      .map((dow) => addDays(w.weekStart, dow))
      .filter((day) => day >= today) // don't back-date sessions into the past
      .map((day) => ({
        planId: plan.id,
        athleteId,
        day,
        discipline: 'strength' as const,
        sessionType: 'cross_train' as const,
        targetDurationSeconds: STRENGTH_MINUTES * 60,
        description: 'Supporting strength session — durability + injury resistance.',
      }));
    if (values.length) {
      await db.insert(plannedSessions).values(values);
      sessions += values.length;
    }
  }

  return { daysPerWeek, weeks: weekRows.length, sessions };
}
