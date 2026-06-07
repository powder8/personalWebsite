/**
 * Dev seed: a small synthetic roster so the console is usable with zero setup.
 * Deterministic (seeded PRNG, fixed "today"). Reuses the real engines + the
 * real persistence layer, so what you see is what the pipeline actually emits.
 *
 * Scenarios are chosen to exercise the roster's needs-attention sorting:
 *  - an elite, fresh and ready
 *  - a masters runner mid-illness (low readiness)
 *  - a recreational runner with an active injury + missed sessions
 */
import type { DB } from './client';
import {
  athletes,
  intakeProfiles,
  hrvRecords,
  restingHrRecords,
  sleepRecords,
  checkIns,
  readinessAssessments,
  injuryRecords,
  athleteNotes,
  races,
} from './schema';
import { addDays, computeBaseline, assessReadiness, type DailyReading } from '@/engine';
import {
  buildZones,
  estimateThresholdSecPerKm,
  generatePlan,
  dowMon0,
} from '@/engine/plan';
import { persistPlanDraft, publishPlan } from './plans';

const TODAY = '2026-06-06';
const SIGNAL_DAYS = 75;
const READINESS_DAYS = 14;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r: () => number, m: number, sd: number) {
  return m + sd * Math.sqrt(-2 * Math.log(Math.max(r(), 1e-9))) * Math.cos(2 * Math.PI * r());
}
const r1 = (x: number) => Math.round(x * 10) / 10;
const clampI = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(x)));

interface Spec {
  id: string;
  name: string;
  email: string;
  race: string;
  raceDate: string;
  threshold: number; // sec/km
  startVol: number;
  peakVol: number;
  hrvBase: number;
  rhrBase: number;
  sleepBase: number;
  seed: number;
  illnessFromEnd?: number; // illness window starting N days before today
  injury?: { bodyPart: string; modalities: string[] };
  missed?: number;
  races?: {
    name: string;
    daysFromToday: number;
    distanceLabel: string;
    priority: 'goal' | 'tune_up' | 'training';
    goalType?: 'time' | 'pace' | 'effort';
    targetPaceSecPerKm?: number;
    targetTimeSeconds?: number;
  }[];
}

const ROSTER: Spec[] = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Moira (elite)',
    email: 'moira@example.com',
    race: 'CIM Marathon',
    raceDate: addDays(TODAY, 56),
    threshold: estimateThresholdSecPerKm({ distanceMeters: 21097.5, timeSeconds: 73 * 60 }),
    startVol: 55,
    peakVol: 72,
    hrvBase: 95,
    rhrBase: 46,
    sleepBase: 7.8,
    seed: 11,
    races: [
      {
        name: 'Turkey Trot 10K',
        daysFromToday: 21,
        distanceLabel: '10K',
        priority: 'tune_up',
        goalType: 'pace',
        targetPaceSecPerKm: 200, // ~5:22/mi tune-up effort
        targetTimeSeconds: 33 * 60 + 20,
      },
      {
        name: 'CIM Marathon',
        daysFromToday: 56,
        distanceLabel: 'Marathon',
        priority: 'goal',
        goalType: 'time',
        targetTimeSeconds: 2 * 3600 + 38 * 60, // 2:38 goal
      },
    ],
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    name: 'Dana (masters)',
    email: 'dana@example.com',
    race: 'Chicago Marathon',
    raceDate: addDays(TODAY, 70),
    threshold: estimateThresholdSecPerKm({ distanceMeters: 21097.5, timeSeconds: 95 * 60 }),
    startVol: 38,
    peakVol: 52,
    hrvBase: 70,
    rhrBase: 54,
    sleepBase: 7.0,
    seed: 22,
    illnessFromEnd: 4, // sick the last few days → low readiness today
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    name: 'Priya (recreational)',
    email: 'priya@example.com',
    race: 'Half Marathon',
    raceDate: addDays(TODAY, 84),
    threshold: estimateThresholdSecPerKm({ distanceMeters: 10000, timeSeconds: 52 * 60 }),
    startVol: 22,
    peakVol: 36,
    hrvBase: 60,
    rhrBase: 60,
    sleepBase: 6.6,
    seed: 33,
    injury: { bodyPart: 'achilles', modalities: ['bike', 'pool_run'] },
    missed: 3,
  },
];

export async function seedIfEmpty(db: DB): Promise<void> {
  const existing = await db.select({ id: athletes.id }).from(athletes).limit(1);
  if (existing.length > 0) return;

  for (const s of ROSTER) {
    await seedAthlete(db, s);
  }
}

async function seedAthlete(db: DB, s: Spec): Promise<void> {
  await db.insert(athletes).values({
    id: s.id,
    fullName: s.name,
    email: s.email,
    timezone: 'America/Los_Angeles',
    goalRace: s.race,
    goalRaceDate: s.raceDate,
  });

  await db.insert(intakeProfiles).values({
    athleteId: s.id,
    typicalWeeklyVolumeKm: s.startVol * 1.609,
    trainingDaysAvailable: 6,
    answers: { thresholdSecPerKm: s.threshold },
  });

  // --- synthetic signals over the trailing window ---
  const rand = rng(s.seed);
  const hrv: DailyReading[] = [];
  const rhr: DailyReading[] = [];
  const sleep: DailyReading[] = [];
  const start = addDays(TODAY, -(SIGNAL_DAYS - 1));
  for (let i = 0; i < SIGNAL_DAYS; i++) {
    const day = addDays(start, i);
    const fromEnd = SIGNAL_DAYS - 1 - i;
    const ill = s.illnessFromEnd != null && fromEnd <= s.illnessFromEnd;
    hrv.push({ day, value: r1(gauss(rand, s.hrvBase + (ill ? -14 : 0), 4)) });
    rhr.push({ day, value: clampI(gauss(rand, s.rhrBase + (ill ? 7 : 0), 2), 35, 90) });
    sleep.push({ day, value: r1(Math.max(3, gauss(rand, s.sleepBase + (ill ? -1.3 : 0), 0.6))) });
  }

  await db.insert(hrvRecords).values(hrv.map((d) => ({ athleteId: s.id, day: d.day, overnightAvgMs: d.value })));
  await db
    .insert(restingHrRecords)
    .values(rhr.map((d) => ({ athleteId: s.id, day: d.day, restingHr: Math.round(d.value) })));
  await db
    .insert(sleepRecords)
    .values(sleep.map((d) => ({ athleteId: s.id, day: d.day, totalSleepSeconds: Math.round(d.value * 3600) })));

  // --- check-ins (last 10 days) ---
  const checkRows = [];
  for (let i = 9; i >= 0; i--) {
    const day = addDays(TODAY, -i);
    const ill = s.illnessFromEnd != null && i <= s.illnessFromEnd;
    checkRows.push({
      athleteId: s.id,
      day,
      soreness: clampI(gauss(rand, ill ? 7 : 3, 1), 0, 10),
      energy: clampI(gauss(rand, ill ? 3 : 7, 1), 0, 10),
      yesterdayRpe: clampI(gauss(rand, 5, 1.5), 0, 10),
    });
  }
  await db.insert(checkIns).values(checkRows);

  // --- readiness assessments (last 14 days), computed by the real engine ---
  const sorenessByDay = new Map(checkRows.map((c) => [c.day, c.soreness]));
  const energyByDay = new Map(checkRows.map((c) => [c.day, c.energy]));
  const readRows = [];
  for (let i = READINESS_DAYS - 1; i >= 0; i--) {
    const day = addDays(TODAY, -i);
    const hrvZ = computeBaseline(hrv, day).latestZ;
    const rhrZ = computeBaseline(rhr, day).latestZ;
    const sleepZ = computeBaseline(sleep, day).latestZ;
    const result = assessReadiness({
      day,
      hrvZ,
      restingHrZ: rhrZ,
      sleepZ,
      soreness: sorenessByDay.get(day) ?? null,
      energy: energyByDay.get(day) ?? null,
      yesterdayRpe: null,
    });
    readRows.push({
      athleteId: s.id,
      day,
      score: result.score,
      band: result.band,
      sentence: result.sentence,
      drivers: result.drivers as unknown as object,
    });
  }
  await db.insert(readinessAssessments).values(readRows);

  // --- races (goal + tune-ups with pace goals) ---
  if (s.races?.length) {
    await db.insert(races).values(
      s.races.map((r) => ({
        athleteId: s.id,
        name: r.name,
        date: addDays(TODAY, r.daysFromToday),
        distanceLabel: r.distanceLabel,
        priority: r.priority,
        goalType: (r.goalType ?? 'none') as 'time' | 'pace' | 'place' | 'effort' | 'none',
        targetPaceSecPerKm: r.targetPaceSecPerKm ?? null,
        targetTimeSeconds: r.targetTimeSeconds ?? null,
      })),
    );
  }

  // --- plan: generate (race-aware), persist drafts, publish past/current weeks ---
  const zones = buildZones(s.threshold);
  const keyRaces = (s.races ?? []).map((r) => ({
    date: addDays(TODAY, r.daysFromToday),
    priority: r.priority,
    label: r.name,
  }));
  const weeks = generatePlan(
    {
      startDay: addDays(TODAY, -49),
      goalRaceDay: s.raceDate,
      startVolumeMiles: s.startVol,
      peakVolumeMiles: s.peakVol,
      keyRaces,
    },
    zones,
  );
  const persisted = await persistPlanDraft(db, s.id, weeks, zones, { seededFor: s.name });
  const currentMonday = addDays(TODAY, -dowMon0(TODAY));
  for (const p of persisted) {
    if (p.weekStart <= currentMonday) await publishPlan(db, p.planId);
  }

  // --- injury + note ---
  if (s.injury) {
    await db.insert(injuryRecords).values({
      athleteId: s.id,
      bodyPart: s.injury.bodyPart,
      severity: 'moderate',
      status: 'returning',
      allowedModalities: s.injury.modalities,
      onsetDate: addDays(TODAY, -12),
      note: 'Tender on push-off; pool-running and easy spins only until pain-free.',
    });
    await db.insert(athleteNotes).values({
      athleteId: s.id,
      kind: 'context',
      body: 'New to structured training — tends to push easy days too hard. Emphasize true recovery pace.',
    });
  }

  if (s.illnessFromEnd != null) {
    await db.insert(athleteNotes).values({
      athleteId: s.id,
      kind: 'reporting_bias',
      body: 'Underreports soreness; cross-check subjective check-ins against HRV/RHR.',
    });
  }
}
