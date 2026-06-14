/* READ-ONLY diagnosis of why an athlete's plan/eval might be empty.
 * Run against the target DB:
 *   DATABASE_URL=<prod> node --import tsx scripts/diagnose-athlete.ts powder8@gmail.com
 */
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { athletes, races, plans, activities, intakeProfiles } from '@/db/schema';

function mondayOnOrBefore(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

(async () => {
  const email = (process.argv[2] || 'powder8@gmail.com').toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const week = mondayOnOrBefore(today);
  const db = await getDb();

  const [a] = await db.select().from(athletes).where(eq(athletes.email, email)).limit(1);
  if (!a) {
    console.log(`No athlete with email ${email}. (Sign-in creates one; has this account signed in?)`);
    process.exit(0);
  }
  const cfg = (a.paceConfig as Record<string, unknown> | null) ?? null;
  const [intake] = await db.select().from(intakeProfiles).where(eq(intakeProfiles.athleteId, a.id)).limit(1);
  const intakeThreshold = (intake?.answers as { thresholdSecPerKm?: number } | null)?.thresholdSecPerKm ?? null;
  const rs = await db.select().from(races).where(eq(races.athleteId, a.id));
  const goalRow = rs.find((r) => r.priority === 'goal');
  const pub = await db.select().from(plans).where(and(eq(plans.athleteId, a.id), eq(plans.status, 'published')));
  const draft = await db.select().from(plans).where(and(eq(plans.athleteId, a.id), eq(plans.status, 'draft')));
  const curPub = pub.find((p) => p.weekStart <= today && p.weekEnd >= today);
  const curDraft = draft.find((p) => p.weekStart <= today && p.weekEnd >= today);
  const runs = await db.select({ st: activities.startTime }).from(activities).where(and(eq(activities.athleteId, a.id), eq(activities.sport, 'run'))).orderBy(desc(activities.startTime)).limit(1);

  console.log(`\nATHLETE  ${a.fullName}  <${a.email}>  id=${a.id}`);
  console.log(`  mode=${a.coachingMode}  onboardedAt=${a.onboardedAt ? 'set' : 'NULL'}  sex=${a.sex ?? 'null'}`);
  console.log(`  ANCHOR: paceConfig=${cfg ? JSON.stringify(cfg) : 'NULL'}  intakeThreshold=${intakeThreshold ?? 'none'}  → ${cfg || intakeThreshold ? 'HAS fitness' : 'NO fitness anchor'}`);
  console.log(`  GOAL summary: ${a.goalRace ?? 'none'} ${a.goalRaceDate ?? ''}`);
  console.log(`  GOAL race row: ${goalRow ? `${goalRow.name} ${goalRow.date} (future=${goalRow.date >= today})` : 'NONE'}  | total races=${rs.length}`);
  console.log(`  PLANS: ${pub.length} published, ${draft.length} draft`);
  console.log(`  THIS WEEK (${week}): published=${curPub ? 'YES' : 'no'} draft=${curDraft ? 'yes' : 'no'}`);
  console.log(`  RUNS: latest=${runs[0]?.st ? runs[0].st.toISOString().slice(0, 10) : 'NONE'}`);
  console.log('');
  // Verdict
  const hasFitness = !!cfg || intakeThreshold != null;
  const hasGoal = !!goalRow || (!!a.goalRace && !!a.goalRaceDate && a.goalRaceDate >= today);
  if (!hasGoal) console.log('LIKELY CAUSE → no goal set: banner should say "Pick your goal". Set a goal to generate a plan.');
  else if (!hasFitness) console.log('LIKELY CAUSE → no fitness anchor: banner should say "Set your fitness". Connect Strava / enter a recent time.');
  else if (!curPub) console.log('LIKELY CAUSE → has goal + fitness but current week not published: coverage should heal on next portal load (post-deploy).');
  else console.log('Looks healthy: goal + fitness + published current week present.');
  process.exit(0);
})();
