import 'server-only';
/**
 * Injury lifecycle — athlete-driven, no treatment advice.
 *
 * Flow (per Peter): the athlete reports "something hurts" and says whether they
 * can keep training. If they can't, we PAUSE running (a windowed directive) and
 * they pick when we should check back. On the check-back date the monitor
 * surfaces "ready to test an easy run?"; only their YES moves the injury to
 * `returning` and starts a gentle ease-back ramp, then `cleared`.
 *
 * We never suggest physio, treatment, or diagnosis — we only pause, ask, and
 * ramp back when they say they're ready.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DB } from '@/db';
import { injuryRecords } from '@/db/schema';
import { createDirective, clearAutoDirectives } from '@/server/directives';
import { injuryCheckDue, addDaysISO } from '@/server/monitorLogic';

export interface ActiveInjury {
  id: string;
  bodyPart: string;
  status: 'acute' | 'returning';
  canContinue: boolean | null;
  checkBackDate: string | null;
  checkDue: boolean; // check-back date reached → prompt "ready to resume?"
  onsetDate: string;
}

export async function getActiveInjury(db: DB, athleteId: string, today: string): Promise<ActiveInjury | null> {
  const [row] = await db
    .select()
    .from(injuryRecords)
    .where(and(eq(injuryRecords.athleteId, athleteId), inArray(injuryRecords.status, ['acute', 'returning'])))
    .orderBy(desc(injuryRecords.onsetDate))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    bodyPart: row.bodyPart,
    status: row.status as 'acute' | 'returning',
    canContinue: row.canContinue,
    checkBackDate: row.checkBackDate,
    checkDue: row.status === 'acute' && injuryCheckDue(row.checkBackDate, today),
    onsetDate: row.onsetDate,
  };
}

/**
 * Report an injury. `canContinue=false` pauses running until the check-back;
 * `true` keeps training but eases it. `checkBackDays` is the self-set follow-up.
 */
export async function reportInjury(
  db: DB,
  athleteId: string,
  today: string,
  input: { bodyPart: string; canContinue: boolean; note?: string; checkBackDays?: number },
): Promise<void> {
  const checkBackDate = input.canContinue
    ? null
    : addDaysISO(today, input.checkBackDays && input.checkBackDays > 0 ? input.checkBackDays : 7);

  await db.insert(injuryRecords).values({
    athleteId,
    bodyPart: input.bodyPart,
    severity: input.canContinue ? 'niggle' : 'moderate',
    status: 'acute',
    onsetDate: today,
    canContinue: input.canContinue,
    checkBackDate,
    note: input.note?.trim() || null,
  });

  // Clear any prior injury directives, then apply the new one immediately (an
  // injury applies in BOTH modes — safety first, never waits on coach approval).
  await clearAutoDirectives(db, athleteId, 'injury');
  if (input.canContinue) {
    await createDirective(db, athleteId, {
      type: 'reduce_volume',
      factor: 0.8,
      from: today,
      to: null,
      label: `${cap(input.bodyPart)} niggle — keeping it easier`,
      source: 'auto',
      category: 'injury',
    });
  } else {
    // Pause running (the day becomes rest) until they say they're ready.
    await createDirective(db, athleteId, {
      type: 'unavailable',
      from: today,
      to: null,
      label: `Resting your ${input.bodyPart.toLowerCase()} — running paused until you're ready`,
      source: 'auto',
      category: 'injury',
    });
  }
}

/** Athlete says they're ready to test a run → returning + gentle ease-back ramp. */
export async function resumeInjury(db: DB, athleteId: string, injuryId: string, today: string): Promise<void> {
  const [row] = await db.select().from(injuryRecords).where(eq(injuryRecords.id, injuryId)).limit(1);
  if (!row || row.athleteId !== athleteId) return;

  await db
    .update(injuryRecords)
    .set({ status: 'returning', canContinue: true, checkBackDate: null, updatedAt: new Date() })
    .where(eq(injuryRecords.id, injuryId));

  // Drop the pause; start an easy-running ramp (calendar never moves).
  await clearAutoDirectives(db, athleteId, 'injury');
  await createDirective(db, athleteId, {
    type: 'reduce_volume',
    factor: 0.6,
    from: today,
    to: addDaysISO(today, 7),
    deltaSecPerMile: 15,
    label: `Easing back after your ${row.bodyPart.toLowerCase()} — start soft, build gradually`,
    source: 'auto',
    category: 'injury',
  });
}

/** Still sore at the check-back → push the next check-back out. */
export async function pushCheckBack(db: DB, athleteId: string, injuryId: string, today: string, days: number): Promise<void> {
  const [row] = await db.select({ athleteId: injuryRecords.athleteId }).from(injuryRecords).where(eq(injuryRecords.id, injuryId)).limit(1);
  if (!row || row.athleteId !== athleteId) return;
  await db
    .update(injuryRecords)
    .set({ checkBackDate: addDaysISO(today, Math.max(1, days)), updatedAt: new Date() })
    .where(eq(injuryRecords.id, injuryId));
}

/** Fully recovered → cleared; drop any remaining injury directive. */
export async function clearInjury(db: DB, athleteId: string, injuryId: string, today: string): Promise<void> {
  const [row] = await db.select({ athleteId: injuryRecords.athleteId }).from(injuryRecords).where(eq(injuryRecords.id, injuryId)).limit(1);
  if (!row || row.athleteId !== athleteId) return;
  await db
    .update(injuryRecords)
    .set({ status: 'cleared', clearedDate: today, updatedAt: new Date() })
    .where(eq(injuryRecords.id, injuryId));
  await clearAutoDirectives(db, athleteId, 'injury');
}

function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
