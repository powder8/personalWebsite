/* Demo seed for the post-run debrief: a trail run with climbs + mid-run breaks,
 * on a day of poor sleep + low energy — exactly the "cheat" scenario. Idempotent. */
import { and, eq, like } from 'drizzle-orm';
import { getDb } from '@/db';
import { activities, sleepRecords, checkIns } from '@/db/schema';

const MI = 1609.344;
const MOIRA = '10000000-0000-4000-8000-000000000001';
const DAY = '2026-06-13';

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

(async () => {
  const db = await getDb();

  // Trail run, climbing, deliberately slow raw pace (labored uphill on soft ground).
  const splits = [
    { distanceMeters: 1000, durationSeconds: 478, paceSecPerKm: 478, avgHr: 150, elevDiffMeters: 22 },
    { distanceMeters: 1000, durationSeconds: 486, paceSecPerKm: 486, avgHr: 152, elevDiffMeters: 20 },
    { distanceMeters: 1000, durationSeconds: 492, paceSecPerKm: 492, avgHr: 149, elevDiffMeters: 18 },
    { distanceMeters: 1000, durationSeconds: 470, paceSecPerKm: 470, avgHr: 151, elevDiffMeters: 14 },
    { distanceMeters: 1000, durationSeconds: 466, paceSecPerKm: 466, avgHr: 153, elevDiffMeters: 8 },
  ];
  const distanceMeters = 5000;
  const movingSeconds = splits.reduce((a, s) => a + s.durationSeconds, 0);
  const elapsedSeconds = movingSeconds + 360; // ~6 min of breaks
  const elevationGainMeters = splits.reduce((a, s) => a + Math.max(0, s.elevDiffMeters), 0); // ~82 m ≈ 270 ft

  await db.delete(activities).where(and(eq(activities.athleteId, MOIRA), like(activities.sourceRef, 'manual:demo-debrief%')));
  const [run] = await db
    .insert(activities)
    .values({
      athleteId: MOIRA,
      sport: 'run',
      provider: 'manual',
      name: 'Fields & trails',
      startTime: new Date(`${DAY}T08:00:00Z`),
      distanceMeters,
      durationSeconds: movingSeconds,
      elapsedSeconds,
      surface: 'trail',
      avgPaceSecPerKm: movingSeconds / (distanceMeters / 1000),
      elevationGainMeters,
      avgHr: 151,
      maxHr: 168,
      splits,
      sourceRef: 'manual:demo-debrief-1',
    })
    .returning({ id: activities.id });

  // Poor sleep that night + a ~7.5h norm from the prior 10 days.
  await db.insert(sleepRecords).values({ athleteId: MOIRA, day: DAY, totalSleepSeconds: Math.round(5.2 * 3600) }).onConflictDoNothing();
  for (let i = 1; i <= 10; i++) {
    await db
      .insert(sleepRecords)
      .values({ athleteId: MOIRA, day: addDays(DAY, -i), totalSleepSeconds: Math.round(7.5 * 3600) })
      .onConflictDoNothing();
  }
  // Felt off: low energy, some soreness.
  await db
    .insert(checkIns)
    .values({ athleteId: MOIRA, day: DAY, energy: 3, soreness: 5, note: 'Felt rough, didn’t sleep well.' })
    .onConflictDoUpdate({ target: [checkIns.athleteId, checkIns.day], set: { energy: 3, soreness: 5 } });

  console.log('Seeded debrief run', run.id, '| 270ft trail, ~6min stops, 5.2h sleep (norm 7.5h), energy 3/10.');
  console.log('Run detail: /me/' + MOIRA + '/runs/' + run.id);
  process.exit(0);
})();
