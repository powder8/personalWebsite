import 'server-only';
/**
 * Athlete insights — Phase 1: descriptive analysis over the athlete's own
 * history. We find the fitness peak and the *ramp into it* (the 8-week block of
 * largest fitness gain), characterize what training looked like during that
 * block — volume, frequency, AND the mix of workout types — vs. baseline and
 * recent training, then offer simple, coach-reviewable suggestions.
 *
 * Workout type is classified ERA-ADAPTIVELY: each run is compared to the median
 * of the athlete's runs within ±60 days, so a 2013 "easy" run and a 2025 "easy"
 * run are both recognized as easy despite different absolute paces. These are
 * n-of-1 associations, not causes; recovery factors join as wearables connect.
 */
import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { activities } from '@/db/schema';
import { computeFitnessFatigue } from '@/engine/fitnessFatigue';
import { selectDailyLoad, NO_ANCHORS } from '@/engine/loadSelectLogic';
import { getLoadCurrency, resolveAthleteLoadAnchors } from '@/db/loadCurrencyConfig';
import { vdotFromRace, STANDARD_DISTANCES } from '@/engine/plan';
import { vdotCeiling, isCorroborated, isRaceEffort, type Effort } from '@/server/perf';
import type { DailyReading } from '@/engine/types';

const MI = 1609.344;
const ASSUMED_EASY_SEC_PER_KM = 330;
const BUILD_DAYS = 56; // 8-week window for "best build"
const RECENT_DAYS = 42; // 6-week window for "recent training"
const BENCHMARK_DAYS = 730; // productive blocks within ~2 years drive current benchmarks
// (older peaks — e.g. a pro-era best — are shown as context, not a target).

export type WorkoutType = 'easy' | 'moderate' | 'quality' | 'long';

interface Run {
  day: string;
  ts: number; // ms
  miles: number;
  paceSecPerKm: number | null;
  durationSeconds: number | null;
  gps: boolean; // from a GPS provider (Strava/Garmin) → per-run pace is real
  isRace: boolean; // race-grade effort → exempt from glitch guards
  type: WorkoutType;
}

export interface WorkoutMix {
  easyPct: number;
  qualityPct: number;
  qualityPerWeek: number;
  longRuns: number;
  avgWeeklyMiles: number;
  runDaysPerWeek: number;
  gpsShare: number; // % of runs from a GPS provider — intensity mix is trustworthy when high
}

export interface Suggestion {
  text: string;
  basis: 'history' | 'science';
}

export interface BuildBlock {
  fromDay: string;
  toDay: string; // the performance date the block led into
  ctlGain: number; // fitness change during the block (context, not the selector)
  weeks: number;
  longestRunMiles: number;
  mix: WorkoutMix;
  /** The peak performance this block produced (what makes it "productive"). */
  performance: { vdot: number; distanceLabel: string; timeLabel: string } | null;
}

/** Pattern aggregated ACROSS an athlete's most-productive blocks (not one). */
export interface BuildProfile {
  count: number; // number of distinct productive blocks found
  reliableCount: number; // those with a trustworthy (GPS) intensity mix
  medianWeeklyMiles: number;
  medianRunDaysPerWeek: number;
  medianQualityPerWeek: number | null; // across GPS-tracked blocks only
  blocksWithLongRuns: number;
  typicalLongestRunMiles: number;
}

export interface TrainingInsights {
  span: { fromDay: string; toDay: string; runs: number; totalMiles: number };
  peak: { day: string; ctl: number };
  /** Best performance ever — shown as CONTEXT (may be a different life stage), not a target. */
  careerBest: { vdot: number; distanceLabel: string; day: string } | null;
  builds: BuildBlock[]; // recent (≤2yr) productive blocks — the actionable benchmark
  buildProfile: BuildProfile | null;
  bestBuild: BuildBlock | null; // = builds[0], kept for the headline highlight
  recent: (WorkoutMix & { weeks: number; hasData: boolean }) | null;
  baseline: { medianWeeklyMiles: number };
  observations: string[];
  suggestions: Suggestion[];
}

function durationOf(a: { durationSeconds: number | null; distanceMeters: number | null; avgPaceSecPerKm: number | null }): number {
  if (a.durationSeconds && a.durationSeconds > 0) return a.durationSeconds;
  const km = (a.distanceMeters ?? 0) / 1000;
  return km <= 0 ? 0 : km * (a.avgPaceSecPerKm ?? ASSUMED_EASY_SEC_PER_KM);
}
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}
function nearestStandard(meters: number): string {
  let best = STANDARD_DISTANCES[0];
  let bestErr = Infinity;
  for (const d of STANDARD_DISTANCES) {
    const err = Math.abs(d.meters - meters) / d.meters;
    if (err < bestErr) {
      bestErr = err;
      best = d;
    }
  }
  return bestErr <= 0.06 ? best.label : `${(meters / MI).toFixed(1)} mi`;
}
/** Per-run performance as a Daniels VDOT, when the run has a usable distance+time. */
function runPerformance(r: Run): { vdot: number; timeSec: number; meters: number } | null {
  const meters = r.miles * MI;
  if (meters < 3000 || meters > 42400) return null; // race-able range only
  const timeSec = r.durationSeconds && r.durationSeconds > 0
    ? r.durationSeconds
    : r.paceSecPerKm
      ? (meters / 1000) * r.paceSecPerKm
      : 0;
  if (timeSec <= 0) return null;
  const v = vdotFromRace({ distanceMeters: meters, timeSeconds: timeSec });
  return Number.isFinite(v) && v >= 20 && v <= 90 ? { vdot: v, timeSec, meters } : null;
}

/**
 * Mix stats for a set of runs spanning `weeks` weeks. Intensity percentages
 * (easy/quality) are computed only over runs we can actually classify — those
 * with pace data, plus long runs (classified by distance) — so a manual log
 * without per-run pace doesn't masquerade as "all easy". `gpsShare` reports
 * how much of the block that was.
 */
function mixOf(runs: Run[], weeks: number): WorkoutMix {
  // Intensity classes are only meaningful for GPS runs (real per-run pace) plus
  // long runs (by distance); a manual log's smooth average paces hide quality.
  const classifiable = runs.filter((r) => r.gps || r.type === 'long');
  const denom = classifiable.length || 1;
  const easy = classifiable.filter((r) => r.type === 'easy').length;
  const quality = classifiable.filter((r) => r.type === 'quality').length;
  const longRuns = runs.filter((r) => r.type === 'long').length;
  const miles = runs.reduce((s, r) => s + r.miles, 0);
  const days = new Set(runs.map((r) => r.day)).size;
  return {
    easyPct: Math.round((easy / denom) * 100),
    qualityPct: Math.round((quality / denom) * 100),
    qualityPerWeek: Math.round((quality / weeks) * 10) / 10,
    longRuns,
    avgWeeklyMiles: Math.round(miles / weeks),
    runDaysPerWeek: Math.round((days / weeks) * 10) / 10,
    gpsShare: Math.round((runs.filter((r) => r.gps).length / (runs.length || 1)) * 100),
  };
}

export async function getTrainingInsights(athleteId: string): Promise<TrainingInsights | null> {
  const db = await getDb();
  const rows = await db
    .select({
      startTime: activities.startTime,
      sport: activities.sport,
      provider: activities.provider,
      name: activities.name,
      workoutType: activities.workoutType,
      distanceMeters: activities.distanceMeters,
      durationSeconds: activities.durationSeconds,
      avgPaceSecPerKm: activities.avgPaceSecPerKm,
      avgHr: activities.avgHr,
      maxHr: activities.maxHr,
      trainingLoad: activities.trainingLoad,
      trainingLoadTss: activities.trainingLoadTss,
    })
    .from(activities)
    .where(eq(activities.athleteId, athleteId))
    .orderBy(asc(activities.startTime));
  if (rows.length < 10) return null;

  // Flag-gated currency swap (spec L2). DEFAULT 'trimp' ⇒ selectDailyLoad returns
  // the exact legacy value, so this is byte-identical to before the cutover.
  const currency = await getLoadCurrency(db);
  const anchors = currency === 'tss' ? await resolveAthleteLoadAnchors(db, athleteId) : NO_ANCHORS;

  // Daily load (all activities — matches the PMC) → CTL/ATL/TSB.
  const loads: DailyReading[] = rows.map((r) => {
    const day = r.startTime.toISOString().slice(0, 10);
    const { value } = selectDailyLoad(
      {
        sport: r.sport,
        durationSeconds: durationOf(r),
        distanceMeters: r.distanceMeters,
        avgHr: r.avgHr,
        avgPaceSecPerKm: r.avgPaceSecPerKm,
        maxHr: r.maxHr,
        trainingLoad: r.trainingLoad,
        trainingLoadTss: r.trainingLoadTss,
      },
      currency,
      anchors,
    );
    return { day, value };
  });
  const from = rows[0].startTime.toISOString().slice(0, 10);
  const to = rows[rows.length - 1].startTime.toISOString().slice(0, 10);
  const ff = computeFitnessFatigue(loads, from, to);

  let peak = ff[0];
  for (const p of ff) if (p.ctl > peak.ctl) peak = p;

  // Runs, classified era-adaptively (vs the local ±60d median pace + distance).
  const rawRuns = rows
    .filter((r) => r.sport === 'run' && (r.distanceMeters ?? 0) > 0)
    .map((r) => ({
      day: r.startTime.toISOString().slice(0, 10),
      ts: r.startTime.getTime(),
      miles: (r.distanceMeters ?? 0) / MI,
      paceSecPerKm: r.avgPaceSecPerKm,
      durationSeconds: r.durationSeconds,
      gps: r.provider === 'strava' || r.provider === 'garmin',
      isRace: isRaceEffort({ workoutType: r.workoutType, name: r.name, meters: r.distanceMeters ?? 0 }),
    }));
  const WIN = 60 * 86400000;
  const runs: Run[] = rawRuns.map((r, i) => {
    // local window paces + miles
    const localPaces: number[] = [];
    const localMiles: number[] = [];
    for (let j = i; j >= 0 && r.ts - rawRuns[j].ts <= WIN; j--) {
      if (rawRuns[j].paceSecPerKm != null) localPaces.push(rawRuns[j].paceSecPerKm!);
      localMiles.push(rawRuns[j].miles);
    }
    for (let j = i + 1; j < rawRuns.length && rawRuns[j].ts - r.ts <= WIN; j++) {
      if (rawRuns[j].paceSecPerKm != null) localPaces.push(rawRuns[j].paceSecPerKm!);
      localMiles.push(rawRuns[j].miles);
    }
    const medPace = median(localPaces);
    const medMiles = median(localMiles);
    let type: WorkoutType;
    if (r.miles >= Math.max(11, medMiles * 1.4)) type = 'long';
    else if (r.paceSecPerKm != null && medPace > 0 && r.paceSecPerKm <= medPace * 0.94) type = 'quality';
    else if (r.paceSecPerKm != null && medPace > 0 && r.paceSecPerKm <= medPace * 0.985) type = 'moderate';
    else type = 'easy';
    return { ...r, type };
  });

  const weeklyMiles = new Map<string, number>();
  for (const r of runs) {
    const wk = r.day.slice(0, 7) + '-' + Math.floor(Number(r.day.slice(8, 10)) / 7);
    weeklyMiles.set(wk, (weeklyMiles.get(wk) ?? 0) + r.miles);
  }
  const medianWeeklyMiles = Math.round(median([...weeklyMiles.values()].filter((m) => m > 0)));

  // Productive blocks = the 8-week training blocks that LED INTO the athlete's
  // best PERFORMANCES (top per-run VDOT efforts), not the biggest fitness ramps.
  // This anchors "productive" on results — high absolute performance — and stays
  // actionable (it's the recipe that produced a peak), avoiding the low-base-ramp
  // artifact and the under-valuing of sustained high fitness.
  const ctlByDay = new Map(ff.map((p) => [p.day, p.ctl]));
  const allPerformers = runs
    .map((r) => ({ r, perf: runPerformance(r) }))
    .filter((x): x is { r: Run; perf: NonNullable<ReturnType<typeof runPerformance>> } => x.perf != null);

  // Reject GPS glitches with the shared guards — but RACES are exempt (a real
  // race can't be a glitch, and an isolated peak race must still surface).
  const ceiling = vdotCeiling(allPerformers.map((x) => x.perf.vdot));
  const performers = allPerformers
    .filter((x) => x.r.isRace || x.perf.vdot <= ceiling)
    .sort((a, b) => b.perf.vdot - a.perf.vdot);
  const effortList: Effort[] = performers.map((x) => ({ ts: x.r.ts, vdot: x.perf.vdot }));

  // Career best (CONTEXT only): the top performance ever, which may be a faster
  // life stage. The benchmark we coach from is recent, not this.
  const top = performers[0];
  const careerBest = top
    ? { vdot: Math.round(top.perf.vdot * 10) / 10, distanceLabel: nearestStandard(top.perf.meters), day: top.r.day }
    : null;

  // Actionable benchmark = productive blocks within the recency window. A
  // 10-year-old pro-era peak is not the yardstick for current training.
  const latestTs = runs.length ? runs[runs.length - 1].ts : 0;
  const recentCutoff = latestTs - BENCHMARK_DAYS * 86400000;

  const builds: BuildBlock[] = [];
  for (const { r, perf } of performers) {
    if (builds.length >= 5) break;
    if (r.ts < recentCutoff) continue; // recent productive blocks only
    if (!r.isRace && !isCorroborated({ ts: r.ts, vdot: perf.vdot }, effortList)) continue;
    // Keep peaks temporally distinct (one block per ~8-week neighborhood).
    if (builds.some((b) => Math.abs(new Date(b.toDay).getTime() - r.ts) < BUILD_DAYS * 86400000)) continue;
    const fromDay = new Date(r.ts - BUILD_DAYS * 86400000).toISOString().slice(0, 10);
    const toDay = r.day;
    const inWindow = runs.filter((x) => x.day >= fromDay && x.day <= toDay);
    if (inWindow.length < 6) continue; // need a real block before the performance
    const ctlGain = Math.round((ctlByDay.get(toDay) ?? 0) - (ctlByDay.get(fromDay) ?? 0));
    builds.push({
      fromDay,
      toDay,
      ctlGain,
      weeks: BUILD_DAYS / 7,
      longestRunMiles: Math.round(inWindow.reduce((mx, x) => Math.max(mx, x.miles), 0) * 10) / 10,
      mix: mixOf(inWindow, BUILD_DAYS / 7),
      performance: {
        vdot: Math.round(perf.vdot * 10) / 10,
        distanceLabel: nearestStandard(perf.meters),
        timeLabel: fmtTime(perf.timeSec),
      },
    });
  }
  const bestBuild = builds[0] ?? null;

  // Aggregate the pattern ACROSS those blocks.
  const reliable = builds.filter((b) => b.mix.gpsShare >= 50);
  const buildProfile: BuildProfile | null = builds.length
    ? {
        count: builds.length,
        reliableCount: reliable.length,
        medianWeeklyMiles: Math.round(median(builds.map((b) => b.mix.avgWeeklyMiles))),
        medianRunDaysPerWeek: Math.round(median(builds.map((b) => b.mix.runDaysPerWeek)) * 10) / 10,
        medianQualityPerWeek: reliable.length
          ? Math.round(median(reliable.map((b) => b.mix.qualityPerWeek)) * 10) / 10
          : null,
        blocksWithLongRuns: builds.filter((b) => b.mix.longRuns > 0).length,
        typicalLongestRunMiles: Math.round(median(builds.map((b) => b.longestRunMiles)) * 10) / 10,
      }
    : null;

  // Recent training (last 6 weeks of the athlete's data).
  const lastTs = runs.length ? runs[runs.length - 1].ts : 0;
  const recentRuns = runs.filter((r) => lastTs - r.ts <= RECENT_DAYS * 86400000);
  const recent: TrainingInsights['recent'] = {
    ...mixOf(recentRuns, RECENT_DAYS / 7),
    weeks: RECENT_DAYS / 7,
    hasData: recentRuns.length >= 4,
  };

  // --- observations (pattern across blocks, not one anecdote) ---
  const observations: string[] = [];
  if (buildProfile && bestBuild) {
    const p = buildProfile;
    const bp = bestBuild.performance;
    observations.push(
      `Recently (last ~2 years), the 8-week blocks behind your ${p.count} best ${p.count === 1 ? 'performance' : 'performances'}${
        bp ? ` (top: ${bp.distanceLabel} ${bp.timeLabel}, ~VDOT ${bp.vdot}, ${bestBuild.toDay})` : ''
      } shared a pattern: ~${p.medianWeeklyMiles} mi/week on ~${p.medianRunDaysPerWeek} run-days/week.`,
    );
    if (careerBest && careerBest.day < bestBuild.fromDay && careerBest.vdot > (bestBuild.performance?.vdot ?? 0) + 2) {
      observations.push(
        `Career best for context: ~VDOT ${careerBest.vdot} (${careerBest.distanceLabel}, ${careerBest.day}) — a faster era; current benchmarks use recent training, not this.`,
      );
    }
    if (p.medianQualityPerWeek != null) {
      observations.push(
        `In the ${p.reliableCount} GPS-tracked of those, the mix was consistently ~${reliable[0].mix.easyPct}% easy with ≈${p.medianQualityPerWeek} quality sessions/week, and ${p.blocksWithLongRuns}/${p.count} included regular long runs (typically up to ${p.typicalLongestRunMiles} mi).`,
      );
    } else {
      observations.push(
        `Those blocks each carried ${p.blocksWithLongRuns ? 'regular long runs and ' : ''}high volume; their easy/quality split is from a logged era so isn't precise (it will be for GPS/Strava data).`,
      );
    }
  }
  observations.push(`Highest fitness on record (CTL ${Math.round(peak.ctl)}) was around ${peak.day}.`);

  // --- suggestions: each "why" backed by a PATTERN across blocks or named science ---
  const suggestions: Suggestion[] = [];
  if (recent.hasData && buildProfile) {
    const p = buildProfile;
    const mixReliable = recent.gpsShare >= 50;

    if (mixReliable && p.medianQualityPerWeek != null && recent.qualityPerWeek + 0.4 < p.medianQualityPerWeek && recent.qualityPerWeek < 1.5) {
      suggestions.push({
        basis: 'history',
        text: `Add a weekly quality session. Across your ${p.reliableCount} strongest GPS-tracked builds you averaged ≈${p.medianQualityPerWeek} threshold/interval sessions a week; you're at ~${recent.qualityPerWeek} lately.`,
      });
    } else if (mixReliable && recent.qualityPct < 12) {
      suggestions.push({
        basis: 'science',
        text: `Your recent mix is ~${recent.easyPct}% easy / ~${recent.qualityPct}% quality. A polarized ~80/20 distribution is repeatedly linked to better endurance gains in trained runners (Seiler; Stöggl & Sperlich, 2014) — a weekly tempo or interval session would help.`,
      });
    }
    if (mixReliable && recent.easyPct < 65) {
      suggestions.push({
        basis: 'science',
        text: `Keep most volume easy (~80%): you're at ~${recent.easyPct}% easy lately. Running easy days truly easy is what lets the hard days be hard (Seiler's intensity-distribution work) — slow them or add easy aerobic miles.`,
      });
    }
    if (p.medianWeeklyMiles > 0 && recent.avgWeeklyMiles < p.medianWeeklyMiles * 0.75) {
      suggestions.push({
        basis: 'history',
        text: `Build volume gradually toward ~${p.medianWeeklyMiles} mi/week — the level your ${p.count} most productive blocks shared. You're ~${recent.avgWeeklyMiles} lately; progress about +10%/week to manage injury risk.`,
      });
    }
    if (recent.runDaysPerWeek + 0.7 < p.medianRunDaysPerWeek) {
      suggestions.push({
        basis: 'history',
        text: `Run more frequently: your most productive blocks averaged ~${p.medianRunDaysPerWeek} run-days/week vs ~${recent.runDaysPerWeek} lately. Consistent frequency (more easy days) is the steadiest driver of fitness.`,
      });
    }
    if (recent.longRuns === 0 && p.blocksWithLongRuns >= Math.ceil(p.count / 2)) {
      suggestions.push({
        basis: 'history',
        text: `Reintroduce a weekly long run — they featured in ${p.blocksWithLongRuns} of your ${p.count} best blocks (typically up to ${p.typicalLongestRunMiles} mi).`,
      });
    }
  } else if (!recent.hasData) {
    suggestions.push({
      basis: 'history',
      text: `Not much recent running to assess — connect Strava or log current training for tailored suggestions.`,
    });
  }

  return {
    span: {
      fromDay: from,
      toDay: to,
      runs: runs.length,
      totalMiles: Math.round(runs.reduce((s, r) => s + r.miles, 0)),
    },
    peak: { day: peak.day, ctl: Math.round(peak.ctl) },
    careerBest,
    builds,
    buildProfile,
    bestBuild,
    recent,
    baseline: { medianWeeklyMiles },
    observations,
    suggestions: suggestions.slice(0, 6),
  };
}
