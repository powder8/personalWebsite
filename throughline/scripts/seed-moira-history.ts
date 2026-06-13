/* Demo seed: give the first demo athlete (Moira) a realistic strong-amateur
 * run history (Strava-sourced, so the anchor advisor sees it). Her best recent
 * effort is a ~39:30 10K (≈ VDOT 53), well under her seeded intake anchor
 * (VDOT 65) — so the race plan's grounding check flags the mismatch and offers
 * to re-anchor. Idempotent: clears its own prior rows first. db/schema only. */
import { and, eq, like, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { athletes, activities, races } from '@/db/schema';

const MI = 1609.344;
const TODAY = '2026-06-13';
// The seeded "Moira (elite)" demo athlete (stable id from db/seed.ts).
const MOIRA_ID = '10000000-0000-4000-8000-000000000001';
function addDays(day: string, n: number): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 7, 0, 0));
}

interface Run { agoDays: number; miles: number; paceSecPerMile: number; name: string; race?: boolean }
// A coherent ~VDOT-53 block: easy miles in the 7:40–8:00 range, a weekly
// tempo/threshold, a long run, and one 10K race at 39:30 three weeks back.
const RUNS: Run[] = [
  { agoDays: 2, miles: 6, paceSecPerMile: 468, name: 'Easy run' },
  { agoDays: 4, miles: 8, paceSecPerMile: 462, name: 'Steady run' },
  { agoDays: 6, miles: 5, paceSecPerMile: 480, name: 'Recovery' },
  { agoDays: 8, miles: 7, paceSecPerMile: 408, name: 'Tempo: 4mi @ threshold' },
  { agoDays: 11, miles: 12, paceSecPerMile: 450, name: 'Long run' },
  { agoDays: 14, miles: 6, paceSecPerMile: 470, name: 'Easy run' },
  { agoDays: 17, miles: 8, paceSecPerMile: 402, name: 'Cruise intervals' },
  { agoDays: 20, miles: 6.21, paceSecPerMile: 381, name: 'Bridge Run 10K', race: true }, // 39:30 10K ≈ VDOT 53
  { agoDays: 24, miles: 10, paceSecPerMile: 455, name: 'Long run' },
  { agoDays: 28, miles: 6, paceSecPerMile: 472, name: 'Easy run' },
  { agoDays: 32, miles: 7, paceSecPerMile: 410, name: 'Tempo' },
  { agoDays: 38, miles: 9, paceSecPerMile: 450, name: 'Long run' },
];

(async () => {
  const db = await getDb();
  // Prefer the stable seed id; fall back to a name match for non-seed DBs.
  const [a] =
    (await db.select().from(athletes).where(eq(athletes.id, MOIRA_ID)).limit(1)).length
      ? await db.select().from(athletes).where(eq(athletes.id, MOIRA_ID)).limit(1)
      : await db.select().from(athletes).where(or(like(athletes.fullName, 'Moira%'), like(athletes.fullName, '%Moira%'))).limit(1);
  if (!a) { console.log('No Moira athlete found; nothing to seed.'); process.exit(0); }
  console.log('Seeding history for', a.fullName, a.id);

  // Make sure the goal race has a distance so the target window + goal-stretch work.
  const goal = (await db.select().from(races).where(and(eq(races.athleteId, a.id), eq(races.priority, 'goal'))).limit(1))[0];
  if (goal && goal.distanceMeters == null) {
    await db.update(races).set({ distanceMeters: 42195 }).where(eq(races.id, goal.id));
    console.log('Set goal distanceMeters = 42195 (marathon).');
  }

  const cleared = await db
    .delete(activities)
    .where(and(eq(activities.athleteId, a.id), or(like(activities.sourceRef, 'strava:demo-hist-%'), like(activities.sourceRef, 'manual:demo-hist-%'))))
    .returning({ id: activities.id });
  console.log('Cleared', cleared.length, 'prior demo-history runs.');

  let i = 0;
  for (const r of RUNS) {
    const meters = r.miles * MI;
    const secPerKm = r.paceSecPerMile / MI * 1000;
    await db.insert(activities).values({
      athleteId: a.id,
      sport: 'run',
      // Manual/imported source — the real coach-spreadsheet case that the
      // anchor advisor used to ignore (Strava-only). Now grounds the anchor.
      provider: 'manual',
      name: r.name,
      workoutType: r.race ? 1 : null,
      startTime: addDays(TODAY, -r.agoDays),
      distanceMeters: meters,
      durationSeconds: Math.round((meters / 1000) * secPerKm),
      avgPaceSecPerKm: secPerKm,
      sourceRef: `manual:demo-hist-${i++}`,
    });
  }
  console.log('Inserted', RUNS.length, 'runs. Best effort: Bridge Run 10K 39:30 (≈ VDOT 53).');
  process.exit(0);
})();
