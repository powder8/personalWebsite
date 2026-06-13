/* Demo seed: one hilly 5K (≈300 ft of climb) with per-km splits + elevation,
 * so the run-detail GAP stat and the grade-adjusted Coach's take are visible.
 * Idempotent. db/schema only. */
import { and, eq, like } from 'drizzle-orm';
import { getDb } from '@/db';
import { activities } from '@/db/schema';

const MI = 1609.344;
const MOIRA_ID = '10000000-0000-4000-8000-000000000001';

(async () => {
  const db = await getDb();
  // A sustained-climb 5K run yesterday: held effort, so pace suffered uphill.
  const splits = [
    { distanceMeters: 1000, durationSeconds: 270, paceSecPerKm: 270, avgHr: 158, elevDiffMeters: 24 },
    { distanceMeters: 1000, durationSeconds: 274, paceSecPerKm: 274, avgHr: 162, elevDiffMeters: 22 },
    { distanceMeters: 1000, durationSeconds: 278, paceSecPerKm: 278, avgHr: 165, elevDiffMeters: 20 },
    { distanceMeters: 1000, durationSeconds: 268, paceSecPerKm: 268, avgHr: 164, elevDiffMeters: 18 },
    { distanceMeters: 1000, durationSeconds: 264, paceSecPerKm: 264, avgHr: 167, elevDiffMeters: 8 },
  ];
  const distanceMeters = 5000;
  const durationSeconds = splits.reduce((a, s) => a + s.durationSeconds, 0);
  const elevationGainMeters = splits.reduce((a, s) => a + Math.max(0, s.elevDiffMeters), 0); // ≈92 m ≈ 300 ft
  const avgPaceSecPerKm = durationSeconds / (distanceMeters / 1000);

  await db.delete(activities).where(and(eq(activities.athleteId, MOIRA_ID), like(activities.sourceRef, 'manual:demo-hilly%')));
  await db.insert(activities).values({
    athleteId: MOIRA_ID,
    sport: 'run',
    provider: 'manual',
    name: 'Hill loop 5K',
    startTime: new Date('2026-06-12T07:00:00Z'),
    distanceMeters,
    durationSeconds,
    avgPaceSecPerKm,
    elevationGainMeters,
    splits,
    sourceRef: 'manual:demo-hilly-1',
  });
  console.log(`Seeded Hill loop 5K: ${Math.round(elevationGainMeters * 3.28084)} ft climb, avg ${(avgPaceSecPerKm * MI / 1000 / 60).toFixed(2)} min/mi raw.`);
  process.exit(0);
})();
