/** Daily self-report. Partial updates preserve answers from other check-in surfaces. */
import { z } from 'zod';
import type { DB } from '@/db';
import { checkIns } from '@/db/schema';

const rating = z.number().int().min(0).max(10).nullable().optional();
export const checkInSchema = z.object({
  day: z.iso.date(),
  soreness: rating,
  energy: rating,
  yesterdayRpe: rating,
  lifeStress: rating,
  sleepQuality: rating,
  note: z.string().trim().max(2000).nullable().optional(),
}).refine((v) => Object.keys(v).some((key) => key !== 'day'), 'Add at least one answer.');

export type CheckInInput = z.infer<typeof checkInSchema>;

export async function submitCheckIn(db: DB, athleteId: string, input: CheckInInput): Promise<void> {
  const { day, ...answers } = checkInSchema.parse(input);
  await db.insert(checkIns).values({ athleteId, day, ...answers })
    .onConflictDoUpdate({
      target: [checkIns.athleteId, checkIns.day],
      set: { ...answers, submittedAt: new Date() },
    });
}
