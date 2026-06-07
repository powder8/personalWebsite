/**
 * Athlete daily check-in: subjective readiness inputs (soreness, energy,
 * yesterday's RPE, free note). Upsert by (athlete, day) so re-submitting the
 * same day updates rather than duplicates — these feed the readiness engine.
 */
import type { DB } from '@/db';
import { checkIns } from '@/db/schema';

export interface CheckInInput {
  day: string; // YYYY-MM-DD
  soreness?: number | null; // 0-10
  energy?: number | null; // 0-10
  yesterdayRpe?: number | null; // 0-10
  note?: string | null;
}

const clamp10 = (n: number | null | undefined): number | null =>
  n == null || Number.isNaN(n) ? null : Math.max(0, Math.min(10, Math.round(n)));

export async function submitCheckIn(db: DB, athleteId: string, input: CheckInInput): Promise<void> {
  if (!input.day) throw new Error('A day is required.');
  const values = {
    athleteId,
    day: input.day,
    soreness: clamp10(input.soreness),
    energy: clamp10(input.energy),
    yesterdayRpe: clamp10(input.yesterdayRpe),
    note: input.note?.trim() || null,
  };
  await db
    .insert(checkIns)
    .values(values)
    .onConflictDoUpdate({
      target: [checkIns.athleteId, checkIns.day],
      set: {
        soreness: values.soreness,
        energy: values.energy,
        yesterdayRpe: values.yesterdayRpe,
        note: values.note,
      },
    });
}
