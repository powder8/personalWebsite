/**
 * Readiness validation harness (Phase 2 spec).
 *
 * Runs the engine day-by-day over each athlete's history and emits a per-day
 * readiness log the coach can grade (agree / too cautious / too aggressive).
 * Those grades become the first eval set.
 *
 * Today it runs on SEEDED SYNTHETIC data so the engine can be exercised before
 * any real Garmin data exists — swap `defaultRoster()` for a DB-backed loader
 * once athletes are connected. Run: `npm run validate`.
 *
 * Output:
 *   - a console summary around the embedded scenarios (visual sanity check)
 *   - validation-output/readiness.csv with an empty `grade` column to fill in
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  computeBaseline,
  assessReadiness,
  addDays,
  diffDays,
  type DailyReading,
} from '../src/engine';
import { defaultRoster, type SyntheticAthlete } from './synthetic';

const BASELINE_WARMUP_DAYS = 60; // need a long window before scoring

interface Row {
  athlete: string;
  day: string;
  hrvZ: number | null;
  rhrZ: number | null;
  sleepZ: number | null;
  soreness: number | null;
  energy: number | null;
  score: number;
  band: string;
  sentence: string;
  annotation: string;
}

/** Consecutive days up to and including `day` where HRV sits below baseline. */
function hrvSuppressionStreak(hrv: DailyReading[], day: string): number {
  let streak = 0;
  let cursor = day;
  for (let i = 0; i < 14; i++) {
    const b = computeBaseline(hrv, cursor);
    if (b.latestZ != null && b.latestZ < -0.5) {
      streak++;
      cursor = addDays(cursor, -1);
    } else break;
  }
  return streak;
}

function runAthlete(a: SyntheticAthlete): Row[] {
  const rows: Row[] = [];
  for (let i = BASELINE_WARMUP_DAYS; i < a.days; i++) {
    const day = addDays(a.startDay, i);
    const hrvZ = computeBaseline(a.hrv, day).latestZ;
    const rhrZ = computeBaseline(a.restingHr, day).latestZ;
    const sleepZ = computeBaseline(a.sleep, day).latestZ;
    const soreness = valueOn(a.soreness, day);
    const energy = valueOn(a.energy, day);
    const yesterdayRpe = valueOn(a.yesterdayRpe, day);

    const result = assessReadiness({
      day,
      hrvZ,
      restingHrZ: rhrZ,
      sleepZ,
      soreness,
      energy,
      yesterdayRpe,
      hrvDaysSuppressed: hrvSuppressionStreak(a.hrv, day),
    });

    rows.push({
      athlete: a.name,
      day,
      hrvZ,
      rhrZ,
      sleepZ,
      soreness,
      energy,
      score: result.score,
      band: result.band,
      sentence: result.sentence,
      annotation: a.annotations[day] ?? '',
    });
  }
  return rows;
}

function valueOn(readings: DailyReading[], day: string): number | null {
  return readings.find((r) => r.day === day)?.value ?? null;
}

function fmtZ(z: number | null): string {
  return z == null ? '  —  ' : (z >= 0 ? '+' : '') + z.toFixed(1);
}

function printScenarioWindow(a: SyntheticAthlete, rows: Row[]) {
  for (const [anchorDay, label] of Object.entries(a.annotations)) {
    console.log(`\n=== ${a.name}: ${label} ===`);
    console.log('day         hrvZ  rhrZ  slpZ  sore  band     score  sentence');
    for (const r of rows) {
      const d = diffDays(r.day, anchorDay);
      if (d < -2 || d > 6) continue;
      const flag = r.annotation ? ' ◀' : '';
      console.log(
        `${r.day}  ${fmtZ(r.hrvZ)} ${fmtZ(r.rhrZ)} ${fmtZ(r.sleepZ)}   ${String(r.soreness ?? '-').padStart(2)}   ${r.band.padEnd(7)} ${String(r.score).padStart(3)}    ${r.sentence}${flag}`,
      );
    }
  }
}

function toCsv(rows: Row[]): string {
  const header = [
    'athlete',
    'day',
    'hrvZ',
    'rhrZ',
    'sleepZ',
    'soreness',
    'energy',
    'score',
    'band',
    'sentence',
    'annotation',
    'grade', // coach fills: agree | too_cautious | too_aggressive
  ];
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.athlete,
      r.day,
      r.hrvZ?.toFixed(2) ?? '',
      r.rhrZ?.toFixed(2) ?? '',
      r.sleepZ?.toFixed(2) ?? '',
      r.soreness ?? '',
      r.energy ?? '',
      r.score,
      r.band,
      r.sentence,
      r.annotation,
      '',
    ]
      .map(esc)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

function main() {
  const roster = defaultRoster();
  const allRows: Row[] = [];
  const bandCounts: Record<string, number> = { easy: 0, normal: 0, go: 0 };

  for (const a of roster) {
    const rows = runAthlete(a);
    allRows.push(...rows);
    rows.forEach((r) => (bandCounts[r.band] = (bandCounts[r.band] ?? 0) + 1));
    printScenarioWindow(a, rows);
  }

  const outPath = join(process.cwd(), 'validation-output', 'readiness.csv');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, toCsv(allRows));

  console.log('\n=== summary ===');
  console.log(`athletes:     ${roster.length}`);
  console.log(`scored days:  ${allRows.length}`);
  console.log(`band mix:     easy ${bandCounts.easy} · normal ${bandCounts.normal} · go ${bandCounts.go}`);
  console.log(`\nGradeable log written to: ${outPath}`);
  console.log("Fill the 'grade' column (agree | too_cautious | too_aggressive) — that's the first eval set.");
}

main();
