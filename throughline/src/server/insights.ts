import 'server-only';
/**
 * Athlete insights — Phase 1: descriptive analysis over the athlete's own
 * history. We find their fitness peak and, more usefully, the *ramp into it*
 * (the 8-week block of largest fitness gain), then characterize what training
 * looked like during that block vs. their baseline.
 *
 * These are coach-reviewable OBSERVATIONS, not prescriptions: with one athlete's
 * data you get associations, not causes. Recovery factors (sleep/HRV/stress)
 * join once wearable data is connected.
 */
import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { activities } from '@/db/schema';
import { computeFitnessFatigue } from '@/engine/fitnessFatigue';
import { estimateLoad } from '@/engine/load';
import type { DailyReading } from '@/engine/types';

const MI = 1609.344;
const ASSUMED_EASY_SEC_PER_KM = 330;
const BUILD_DAYS = 56; // 8-week window for "best build"

export interface TrainingInsights {
  span: { fromDay: string; toDay: string; runs: number; totalMiles: number };
  peak: { day: string; ctl: number };
  bestBuild: {
    fromDay: string;
    toDay: string;
    ctlGain: number;
    weeks: number;
    avgWeeklyMiles: number;
    runDaysPerWeek: number;
    longestRunMiles: number;
  } | null;
  baseline: { medianWeeklyMiles: number; typicalRunDaysPerWeek: number };
  deepestFatigue: { day: string; tsb: number } | null;
  observations: string[];
}

function durationOf(a: { durationSeconds: number | null; distanceMeters: number | null; avgPaceSecPerKm: number | null }): number {
  if (a.durationSeconds && a.durationSeconds > 0) return a.durationSeconds;
  const km = (a.distanceMeters ?? 0) / 1000;
  return km <= 0 ? 0 : km * (a.avgPaceSecPerKm ?? ASSUMED_EASY_SEC_PER_KM);
}

function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = (dt.getUTCDay() + 6) % 7; // 0 = Monday
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export async function getTrainingInsights(athleteId: string): Promise<TrainingInsights | null> {
  const db = await getDb();
  const rows = await db
    .select({
      startTime: activities.startTime,
      sport: activities.sport,
      distanceMeters: activities.distanceMeters,
      durationSeconds: activities.durationSeconds,
      avgPaceSecPerKm: activities.avgPaceSecPerKm,
      avgHr: activities.avgHr,
      trainingLoad: activities.trainingLoad,
    })
    .from(activities)
    .where(eq(activities.athleteId, athleteId))
    .orderBy(asc(activities.startTime));
  if (rows.length < 10) return null;

  // Daily load (all activities — matches the PMC) → CTL/ATL/TSB series.
  const loads: DailyReading[] = rows.map((r) => {
    const day = r.startTime.toISOString().slice(0, 10);
    if (r.trainingLoad && r.trainingLoad > 0) return { day, value: r.trainingLoad };
    return { day, value: estimateLoad({ durationSeconds: durationOf(r), avgHr: r.avgHr, distanceMeters: r.distanceMeters }).load };
  });
  const from = rows[0].startTime.toISOString().slice(0, 10);
  const to = rows[rows.length - 1].startTime.toISOString().slice(0, 10);
  const ff = computeFitnessFatigue(loads, from, to);

  // Peak fitness + deepest fatigue (form).
  let peak = ff[0];
  let deepest = ff[0];
  for (const p of ff) {
    if (p.ctl > peak.ctl) peak = p;
    if (p.tsb < deepest.tsb) deepest = p;
  }

  // Best build = the 8-week window with the largest CTL gain (the ramp).
  let best: { i: number; gain: number } | null = null;
  for (let i = BUILD_DAYS; i < ff.length; i++) {
    const gain = ff[i].ctl - ff[i - BUILD_DAYS].ctl;
    if (!best || gain > best.gain) best = { i, gain };
  }

  // Running volume by week (runs only — bikes shouldn't inflate "miles").
  const runs = rows.filter((r) => r.sport === 'run' && (r.distanceMeters ?? 0) > 0);
  const milesByWeek = new Map<string, number>();
  const runDaysByWeek = new Map<string, Set<string>>();
  for (const r of runs) {
    const day = r.startTime.toISOString().slice(0, 10);
    const wk = mondayOf(day);
    milesByWeek.set(wk, (milesByWeek.get(wk) ?? 0) + (r.distanceMeters ?? 0) / MI);
    if (!runDaysByWeek.has(wk)) runDaysByWeek.set(wk, new Set());
    runDaysByWeek.get(wk)!.add(day);
  }
  const activeWeeks = [...milesByWeek.values()].filter((m) => m > 0);
  const medianWeeklyMiles = Math.round(median(activeWeeks));
  const typicalRunDays = Math.round(median([...runDaysByWeek.values()].map((s) => s.size)) * 10) / 10;

  // Characterize the best-build window.
  let bestBuild: TrainingInsights['bestBuild'] = null;
  const observations: string[] = [];
  if (best && best.gain > 1) {
    const fromDay = ff[best.i - BUILD_DAYS].day;
    const toDay = ff[best.i].day;
    const inWindow = runs.filter((r) => {
      const d = r.startTime.toISOString().slice(0, 10);
      return d >= fromDay && d <= toDay;
    });
    const weeks = BUILD_DAYS / 7;
    const windowMiles = inWindow.reduce((s, r) => s + (r.distanceMeters ?? 0) / MI, 0);
    const windowRunDays = new Set(inWindow.map((r) => r.startTime.toISOString().slice(0, 10))).size;
    const longestRunMiles = inWindow.reduce((mx, r) => Math.max(mx, (r.distanceMeters ?? 0) / MI), 0);
    bestBuild = {
      fromDay,
      toDay,
      ctlGain: Math.round(best.gain),
      weeks,
      avgWeeklyMiles: Math.round(windowMiles / weeks),
      runDaysPerWeek: Math.round((windowRunDays / weeks) * 10) / 10,
      longestRunMiles: Math.round(longestRunMiles * 10) / 10,
    };
    observations.push(
      `Your biggest fitness build was the 8 weeks ending ${toDay}: fitness (CTL) rose ${bestBuild.ctlGain}, on ~${bestBuild.avgWeeklyMiles} mi/week across ~${bestBuild.runDaysPerWeek} run-days/week.`,
    );
    if (bestBuild.avgWeeklyMiles > medianWeeklyMiles) {
      observations.push(
        `That was ${Math.round(((bestBuild.avgWeeklyMiles - medianWeeklyMiles) / Math.max(1, medianWeeklyMiles)) * 100)}% more volume than your typical ${medianWeeklyMiles} mi/week — consistent volume tends to be the strongest driver.`,
      );
    }
    if (bestBuild.longestRunMiles > 0) {
      observations.push(`Longest run during that block: ${bestBuild.longestRunMiles} mi.`);
    }
  }

  observations.push(`Highest fitness on record (CTL ${Math.round(peak.ctl)}) was around ${peak.day}.`);
  if (deepest.tsb < -20) {
    observations.push(
      `Deepest fatigue (form ${Math.round(deepest.tsb)}) was around ${deepest.day} — worth checking what preceded it for overreaching signs once recovery data is connected.`,
    );
  }

  return {
    span: {
      fromDay: from,
      toDay: to,
      runs: runs.length,
      totalMiles: Math.round(runs.reduce((s, r) => s + (r.distanceMeters ?? 0) / MI, 0)),
    },
    peak: { day: peak.day, ctl: Math.round(peak.ctl) },
    bestBuild,
    baseline: { medianWeeklyMiles, typicalRunDaysPerWeek: typicalRunDays },
    deepestFatigue: deepest.tsb < -20 ? { day: deepest.day, tsb: Math.round(deepest.tsb) } : null,
    observations,
  };
}
