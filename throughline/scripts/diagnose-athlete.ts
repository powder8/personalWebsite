/* READ-ONLY diagnosis of why an athlete's plan/eval might be empty.
 * Run against the target DB:
 *   DATABASE_URL=<prod> node --import tsx scripts/diagnose-athlete.ts powder8@gmail.com
 */
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { athletes, races, plans, activities, intakeProfiles } from '@/db/schema';
import { vdotFromRace } from '@/engine/plan';

const MI = 1609.344;

function mondayOnOrBefore(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}
const dur = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
const paceMi = (meters: number, sec: number) => {
  const sp = sec / (meters / MI);
  return `${Math.floor(sp / 60)}:${String(Math.round(sp % 60)).padStart(2, '0')}/mi`;
};
/** VDOT the anchor (paceConfig) currently implies, if derivable. */
function anchorVdot(cfg: Record<string, unknown> | null): number | null {
  if (!cfg) return null;
  if (typeof cfg.vdot === 'number') return cfg.vdot;
  const race = cfg.race as { distanceMeters?: number; timeSeconds?: number } | undefined;
  if (race?.distanceMeters && race?.timeSeconds) return vdotFromRace({ distanceMeters: race.distanceMeters, timeSeconds: race.timeSeconds });
  return null;
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
  // Recent activities (all sports) with full timestamps — to confirm a specific run is imported.
  const recent = await db
    .select({
      startTime: activities.startTime,
      sport: activities.sport,
      name: activities.name,
      workoutType: activities.workoutType,
      distanceMeters: activities.distanceMeters,
      durationSeconds: activities.durationSeconds,
      avgPaceSecPerKm: activities.avgPaceSecPerKm,
      sourceRef: activities.sourceRef,
    })
    .from(activities)
    .where(eq(activities.athleteId, a.id))
    .orderBy(desc(activities.startTime))
    .limit(15);

  console.log(`\nATHLETE  ${a.fullName}  <${a.email}>  id=${a.id}`);
  console.log(`  mode=${a.coachingMode}  onboardedAt=${a.onboardedAt ? 'set' : 'NULL'}  sex=${a.sex ?? 'null'}`);
  console.log(`  ANCHOR: paceConfig=${cfg ? JSON.stringify(cfg) : 'NULL'}  intakeThreshold=${intakeThreshold ?? 'none'}  → ${cfg || intakeThreshold ? 'HAS fitness' : 'NO fitness anchor'}`);
  console.log(`  GOAL summary: ${a.goalRace ?? 'none'} ${a.goalRaceDate ?? ''}`);
  console.log(`  GOAL race row: ${goalRow ? `${goalRow.name} ${goalRow.date} (future=${goalRow.date >= today})` : 'NONE'}  | total races=${rs.length}`);
  console.log(`  PLANS: ${pub.length} published, ${draft.length} draft`);
  console.log(`  THIS WEEK (${week}): published=${curPub ? 'YES' : 'no'} draft=${curDraft ? 'yes' : 'no'}`);
  console.log(`  RUNS: latest=${runs[0]?.st ? runs[0].st.toISOString().slice(0, 10) : 'NONE'}`);

  // --- Recent activities (does the run in question exist? what VDOT does it imply?) ---
  console.log(`\n  RECENT ACTIVITIES (most recent ${recent.length}, times in UTC):`);
  if (recent.length === 0) console.log('    (none imported)');
  const aV = anchorVdot(cfg);
  let bestRecentVdot: number | null = null;
  const today180 = new Date(`${today}T00:00:00Z`);
  today180.setUTCDate(today180.getUTCDate() - 180);
  for (const r of recent) {
    const m = r.distanceMeters ?? 0;
    const t = r.durationSeconds && r.durationSeconds > 0 ? r.durationSeconds : r.avgPaceSecPerKm ? Math.round((m / 1000) * r.avgPaceSecPerKm) : 0;
    const isRunEffort = r.sport === 'run' && m >= 3000 && m <= 21100 && t > 0;
    const v = isRunEffort ? vdotFromRace({ distanceMeters: m, timeSeconds: t }) : null;
    if (v != null && Number.isFinite(v) && v >= 20 && v <= 90 && r.startTime >= today180) {
      bestRecentVdot = Math.max(bestRecentVdot ?? 0, v);
    }
    const pace = r.sport === 'run' && m > 0 && t ? paceMi(m, t) : '';
    console.log(
      `    ${r.startTime.toISOString().replace('.000', '')}  ${r.sport.padEnd(5)} ${(m / MI).toFixed(2).padStart(6)}mi  ${t ? dur(t).padStart(7) : '   —   '}  ${pace.padStart(8)}  ${v != null ? `VDOT≈${v.toFixed(1)}` : ''}  wt=${r.workoutType ?? '-'}  ${r.sourceRef ?? ''}`,
    );
  }

  // --- Anchor analysis ---
  console.log(`\n  ANCHOR ANALYSIS:`);
  console.log(`    current anchor VDOT ≈ ${aV != null ? aV.toFixed(1) : 'none'} (source=${(cfg?.anchorSource as string) ?? 'unset'})`);
  console.log(`    best demonstrated race VDOT in last 180d ≈ ${bestRecentVdot != null ? bestRecentVdot.toFixed(1) : 'none'}`);
  if (bestRecentVdot != null) {
    const wouldAdopt =
      a.coachingMode === 'autonomous' &&
      ((cfg?.anchorSource as string) !== 'manual' || aV == null || bestRecentVdot > aV + 2);
    console.log(`    → auto-anchor (this athlete is ${a.coachingMode}) ${wouldAdopt ? 'WOULD adopt the recent race' : 'would KEEP the current anchor'}`);
  }
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
