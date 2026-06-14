/* Backfill elapsed_seconds + surface on existing activities from the raw Strava
 * payloads we already stored (raw_events). Idempotent: only fills columns that
 * are still null, never clobbers. Safe to re-run.
 *
 * Run against the target DB:  DATABASE_URL=<prod> node --import tsx scripts/backfill-elapsed-surface.ts
 */
import { and, eq, isNull, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { rawEvents, activities } from '@/db/schema';
import { mapSurface } from '@/providers/strava';

interface RawStrava {
  id?: number;
  elapsed_time?: number;
  sport_type?: string;
  type?: string;
}

(async () => {
  const db = await getDb();
  const rows = await db
    .select({ payload: rawEvents.payload })
    .from(rawEvents)
    .where(and(eq(rawEvents.provider, 'strava'), eq(rawEvents.eventType, 'activity')));

  let scanned = 0;
  let updated = 0;
  for (const r of rows) {
    const a = (r.payload ?? {}) as RawStrava;
    if (!a.id) continue;
    scanned++;
    const elapsed = a.elapsed_time ?? null;
    const surface = mapSurface(a.sport_type ?? a.type);
    if (elapsed == null && surface == null) continue;

    const res = await db
      .update(activities)
      .set({ elapsedSeconds: elapsed ?? undefined, surface: surface ?? undefined })
      .where(
        and(
          eq(activities.sourceRef, `strava:${a.id}`),
          or(isNull(activities.elapsedSeconds), isNull(activities.surface)),
        ),
      )
      .returning({ id: activities.id });
    if (res.length) updated++;
  }
  console.log(`Backfill complete: scanned ${scanned} Strava raw events, updated ${updated} activities.`);
  process.exit(0);
})();
