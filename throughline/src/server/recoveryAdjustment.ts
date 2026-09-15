import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '@/db';
import { directives } from '@/db/schema';
import { addDays } from '@/engine';

export const recoveryAdjustmentSchema = z.object({
  day: z.iso.date(),
  mode: z.enum(['easy', 'rest', 'clear']),
  days: z.union([z.literal(1), z.literal(3), z.literal(7)]).default(1),
});

/** Same athlete/start-day has one replaceable choice, even on retries. */
export function recoveryAdjustmentId(athleteId: string, day: string) {
  const h = createHash('sha256').update(`recovery:${athleteId}:${day}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function setRecoveryAdjustment(db: DB, athleteId: string, input: z.infer<typeof recoveryAdjustmentSchema>) {
  const id = recoveryAdjustmentId(athleteId, input.day);
  if (input.mode === 'clear') {
    await db.update(directives).set({ active: false }).where(and(eq(directives.id, id), eq(directives.athleteId, athleteId)));
    return;
  }
  const values = {
    active: true,
    effectiveFrom: input.day,
    effectiveTo: addDays(input.day, input.days - 1),
    params: { type: input.mode === 'rest' ? 'unavailable' : 'recovery_day', factor: 0.7, source: 'athlete', category: 'low_recovery', status: 'active' },
    sourceText: input.mode === 'rest' ? 'Recovery break chosen by you' : 'Recovery adjustment chosen by you',
  };
  await db.insert(directives).values({ id, athleteId, kind: 'other', ...values })
    .onConflictDoUpdate({ target: directives.id, set: values });
}
