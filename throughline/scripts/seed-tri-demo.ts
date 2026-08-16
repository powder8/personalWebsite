/**
 * Dev-only: seed one triathlete with a TIMED 70.3 goal so the portal renders the
 * multi-sport goal tracker. Scoped to a fixed demo UUID — touches only that
 * athlete's own rows. Run with the dev server STOPPED (single-process PGlite).
 */
import { getDb } from '@/db';
import { athletes } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { setupTriSeason } from '@/server/triSeason';

const ID = '77777777-7777-4777-8777-777777777777';

async function main() {
  const db = await getDb();
  await db.delete(athletes).where(eq(athletes.id, ID));
  await db.insert(athletes).values({
    id: ID,
    fullName: 'Pat Tri-Athlete',
    email: 'pat-tri@example.com',
    timezone: 'UTC',
    coachingMode: 'autonomous',
    dateOfBirth: '1975-01-01', // ~52 at race day — engages the attainability ceiling
    paceConfig: { vdot: 48 },
    powerConfig: { ftpWatts: 240, weightKg: 74 },
    swimConfig: { cssMetersPerSec: 1.3 },
  });

  const res = await setupTriSeason(db, ID, {
    startDay: '2026-08-17',
    goalRace: { name: 'Oceanside 70.3', date: '2027-06-13', distance: '70.3', distanceMeters: 70300 },
    weeklyHours: 9,
    limiter: 'swim',
    goalFinishSeconds: 4 * 3600 + 30 * 60, // sub-4:30 — a real stretch
    publish: true,
  });

  console.log('Seeded tri athlete:', ID);
  console.log('Verdict:', res.feasibility?.verdict, '| binding:', res.feasibility?.bindingLeg);
  console.log('Portal: /me/' + ID);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
