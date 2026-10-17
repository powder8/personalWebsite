/**
 * The athlete's own calendar day, read from their stored timezone. Every
 * athlete-scoped page and route uses this, so the portal, check-ins, plan
 * setup, and syncs all agree on what "today" is for that athlete.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { athletes } from '@/db/schema';
import { todayForTimezone } from '@/lib/today';

export async function athleteToday(athleteId: string): Promise<string> {
  const db = await getDb();
  const [row] = await db.select({ timezone: athletes.timezone }).from(athletes).where(eq(athletes.id, athleteId)).limit(1);
  return todayForTimezone(row?.timezone);
}
