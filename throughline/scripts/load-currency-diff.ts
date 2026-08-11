/**
 * L2 diff report — the artifact the owner reviews BEFORE any cutover.
 *
 * Recomputes the PMC (CTL/ATL/TSB) over each athlete's full history in BOTH
 * currencies and prints a per-athlete before/after:
 *   - CURRENT (TRIMP): exactly what `server/fitness.ts` reads today —
 *     `activities.trainingLoad` when present, else the legacy volume proxy
 *     (`estimateLoad`, no HR → `durMin × 0.7`).
 *   - NEW (TSS-equivalent): `activities.trainingLoadTss`, from the L1 backfill.
 *
 * Reports the magnitude shift (CTL/ATL/TSB current vs new, and the ratio k), and
 * — critically — whether the `form` label ('fresh' > +5, 'fatigued' < −10, else
 * 'neutral') still classifies the SAME after the renumber. Label stability across
 * the roster is the L2 acceptance test.
 *
 * OFFLINE + READ-ONLY: no writes. Runs against whatever `getDb()` resolves
 * (local PGlite in dev). The prod / replica run is the OWNER's job — never point
 * this at production `DATABASE_URL`.
 *
 *   DATABASE_URL='' node --import tsx scripts/load-currency-diff.ts
 */
import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { activities, athletes } from '@/db/schema';
import { computeFitnessFatigue } from '@/engine/fitnessFatigue';
import { estimateLoad } from '@/engine/load';
import type { DailyReading, FitnessFatiguePoint } from '@/engine/types';

const ASSUMED_EASY_SEC_PER_KM = 330; // mirrors server/fitness.ts

// Form thresholds — kept identical to server/fitness.ts so the report reflects
// what the app would label. (L2 may recalibrate these from THIS report.)
const FRESH_ABOVE = 5;
const FATIGUED_BELOW = -10;
type Form = 'fresh' | 'neutral' | 'fatigued';
function form(tsb: number): Form {
  return tsb > FRESH_ABOVE ? 'fresh' : tsb < FATIGUED_BELOW ? 'fatigued' : 'neutral';
}

/** Duration exactly as server/fitness.ts derives it (distance × pace fallback). */
function activityDuration(a: {
  durationSeconds: number | null;
  distanceMeters: number | null;
  avgPaceSecPerKm: number | null;
}): number {
  if (a.durationSeconds != null && a.durationSeconds > 0) return a.durationSeconds;
  const km = (a.distanceMeters ?? 0) / 1000;
  if (km <= 0) return 0;
  return km * (a.avgPaceSecPerKm ?? ASSUMED_EASY_SEC_PER_KM);
}

function current(day: string, day2: string, loads: DailyReading[]): FitnessFatiguePoint[] {
  return computeFitnessFatigue(loads, day, day2);
}

function fmt(n: number): string {
  return n.toFixed(1).padStart(7);
}
function pctl(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
}

async function main() {
  const db = await getDb();
  const roster = await db.select().from(athletes);

  console.log('LOAD-CURRENCY DIFF REPORT  (TRIMP/volume "current"  →  TSS-equivalent "new")');
  console.log('Read-only; local dev data. Nothing is written. Form: fresh > +5, fatigued < −10.\n');

  let labelFlips = 0;
  let athletesWithData = 0;

  for (const a of roster) {
    const rows = await db
      .select({
        startTime: activities.startTime,
        durationSeconds: activities.durationSeconds,
        distanceMeters: activities.distanceMeters,
        avgPaceSecPerKm: activities.avgPaceSecPerKm,
        avgHr: activities.avgHr,
        trainingLoad: activities.trainingLoad,
        trainingLoadTss: activities.trainingLoadTss,
        loadConfidence: activities.loadConfidence,
      })
      .from(activities)
      .where(eq(activities.athleteId, a.id))
      .orderBy(asc(activities.startTime));

    if (rows.length === 0) continue;
    athletesWithData++;

    // CURRENT currency — byte-for-byte what server/fitness.ts feeds the PMC.
    const currentLoads: DailyReading[] = rows.map((r) => {
      const day = r.startTime.toISOString().slice(0, 10);
      if (r.trainingLoad != null && r.trainingLoad > 0) return { day, value: r.trainingLoad };
      const dur = activityDuration(r);
      return { day, value: estimateLoad({ durationSeconds: dur, avgHr: r.avgHr, distanceMeters: r.distanceMeters }).load };
    });

    // NEW currency — the L1 backfill's parallel column.
    const newLoads: DailyReading[] = rows.map((r) => ({
      day: r.startTime.toISOString().slice(0, 10),
      value: r.trainingLoadTss ?? 0,
    }));

    const from = rows[0].startTime.toISOString().slice(0, 10);
    const to = rows[rows.length - 1].startTime.toISOString().slice(0, 10);
    const cur = current(from, to, currentLoads);
    const neu = current(from, to, newLoads);

    const curLast = cur[cur.length - 1];
    const neuLast = neu[neu.length - 1];
    const curPeak = cur.reduce((m, p) => Math.max(m, p.ctl), 0);
    const neuPeak = neu.reduce((m, p) => Math.max(m, p.ctl), 0);
    const k = curLast.ctl > 0 ? neuLast.ctl / curLast.ctl : 0;

    const curForm = form(curLast.tsb);
    const neuForm = form(neuLast.tsb);
    const flipped = curForm !== neuForm;
    if (flipped) labelFlips++;

    // confidence mix
    const mix = rows.reduce<Record<string, number>>((m, r) => {
      const c = r.loadConfidence ?? 'unbackfilled';
      m[c] = (m[c] ?? 0) + 1;
      return m;
    }, {});

    console.log(`── ${a.fullName}  (${rows.length} acts, ${from} → ${to})`);
    console.log(`   confidence mix: ${Object.entries(mix).map(([c, n]) => `${c}:${n}`).join('  ')}`);
    console.log('                      CTL      ATL      TSB     form');
    console.log(`   current (TRIMP): ${fmt(curLast.ctl)} ${fmt(curLast.atl)} ${fmt(curLast.tsb)}   ${curForm}`);
    console.log(`   new     (TSS)  : ${fmt(neuLast.ctl)} ${fmt(neuLast.atl)} ${fmt(neuLast.tsb)}   ${neuForm}`);
    console.log(
      `   shift          :  CTL ×${k.toFixed(2)}   peak CTL ${curPeak.toFixed(1)} → ${neuPeak.toFixed(1)}   ` +
        `TSB spread(p10..p90) cur[${fmt(pctl(cur.map((p) => p.tsb), 10)).trim()}..${fmt(pctl(cur.map((p) => p.tsb), 90)).trim()}] ` +
        `new[${fmt(pctl(neu.map((p) => p.tsb), 10)).trim()}..${fmt(pctl(neu.map((p) => p.tsb), 90)).trim()}]`,
    );
    console.log(`   label stability: ${flipped ? `⚠ FLIPPED ${curForm} → ${neuForm} (review)` : 'stable ✓'}\n`);
  }

  console.log('─'.repeat(78));
  console.log(
    `SUMMARY: ${athletesWithData} athletes with data; ${labelFlips} form-label flip(s) at cutover. ` +
      `${labelFlips === 0 ? 'Label stability holds — thresholds need no change for this roster.' : 'Review flips before picking thresholds.'}`,
  );
  console.log(
    'Note: in dev the "current" side is the volume proxy (trainingLoad is null), so the shift here\n' +
      'reflects volume-proxy → pace/HR-graded TSS. On prod/replica (real TRIMP), expect CTL ≈ 0.55–0.7× (spec §2.3).',
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
