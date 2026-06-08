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
import { estimateLoad } from '@/engine/load';
import type { DailyReading } from '@/engine/types';

const MI = 1609.344;
const ASSUMED_EASY_SEC_PER_KM = 330;
const BUILD_DAYS = 56; // 8-week window for "best build"
const RECENT_DAYS = 42; // 6-week window for "recent training"

export type WorkoutType = 'easy' | 'moderate' | 'quality' | 'long';

interface Run {
  day: string;
  ts: number; // ms
  miles: number;
  paceSecPerKm: number | null;
  gps: boolean; // from a GPS provider (Strava/Garmin) → per-run pace is real
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

export interface TrainingInsights {
  span: { fromDay: string; toDay: string; runs: number; totalMiles: number };
  peak: { day: string; ctl: number };
  bestBuild: {
    fromDay: string;
    toDay: string;
    ctlGain: number;
    weeks: number;
    longestRunMiles: number;
    mix: WorkoutMix;
  } | null;
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

  // Daily load (all activities — matches the PMC) → CTL/ATL/TSB.
  const loads: DailyReading[] = rows.map((r) => {
    const day = r.startTime.toISOString().slice(0, 10);
    if (r.trainingLoad && r.trainingLoad > 0) return { day, value: r.trainingLoad };
    return { day, value: estimateLoad({ durationSeconds: durationOf(r), avgHr: r.avgHr, distanceMeters: r.distanceMeters }).load };
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
      gps: r.provider === 'strava' || r.provider === 'garmin',
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

  // Best build = 8-week window of largest CTL gain (the ramp).
  let best: { i: number; gain: number } | null = null;
  for (let i = BUILD_DAYS; i < ff.length; i++) {
    const gain = ff[i].ctl - ff[i - BUILD_DAYS].ctl;
    if (!best || gain > best.gain) best = { i, gain };
  }
  let bestBuild: TrainingInsights['bestBuild'] = null;
  if (best && best.gain > 1) {
    const fromDay = ff[best.i - BUILD_DAYS].day;
    const toDay = ff[best.i].day;
    const inWindow = runs.filter((r) => r.day >= fromDay && r.day <= toDay);
    const longestRunMiles = inWindow.reduce((mx, r) => Math.max(mx, r.miles), 0);
    bestBuild = {
      fromDay,
      toDay,
      ctlGain: Math.round(best.gain),
      weeks: BUILD_DAYS / 7,
      longestRunMiles: Math.round(longestRunMiles * 10) / 10,
      mix: mixOf(inWindow, BUILD_DAYS / 7),
    };
  }

  // Recent training (last 6 weeks of the athlete's data).
  const lastTs = runs.length ? runs[runs.length - 1].ts : 0;
  const recentRuns = runs.filter((r) => lastTs - r.ts <= RECENT_DAYS * 86400000);
  const recent: TrainingInsights['recent'] = {
    ...mixOf(recentRuns, RECENT_DAYS / 7),
    weeks: RECENT_DAYS / 7,
    hasData: recentRuns.length >= 4,
  };

  // --- observations ---
  const observations: string[] = [];
  if (bestBuild) {
    observations.push(
      `Your biggest fitness build was the 8 weeks ending ${bestBuild.toDay}: fitness (CTL) rose ${bestBuild.ctlGain}, on ~${bestBuild.mix.avgWeeklyMiles} mi/week across ~${bestBuild.mix.runDaysPerWeek} run-days/week.`,
    );
    if (bestBuild.mix.gpsShare >= 50) {
      observations.push(
        `That block's mix: ~${bestBuild.mix.easyPct}% easy and ~${bestBuild.mix.qualityPct}% quality (≈${bestBuild.mix.qualityPerWeek} hard sessions/week), with ${bestBuild.mix.longRuns} long runs (longest ${bestBuild.longestRunMiles} mi).`,
      );
    } else {
      observations.push(
        `${bestBuild.mix.longRuns} long runs that block (longest ${bestBuild.longestRunMiles} mi). The easy/quality mix isn't reliable here — only ${bestBuild.mix.gpsShare}% of those runs came from GPS (this was a logged era; manual logs hide intensity). It'll be precise for GPS/Strava data.`,
      );
    }
    if (bestBuild.mix.avgWeeklyMiles > medianWeeklyMiles) {
      observations.push(
        `Volume then was ${Math.round(((bestBuild.mix.avgWeeklyMiles - medianWeeklyMiles) / Math.max(1, medianWeeklyMiles)) * 100)}% above your typical ${medianWeeklyMiles} mi/week — consistent volume tends to be the strongest driver.`,
      );
    }
  }
  observations.push(`Highest fitness on record (CTL ${Math.round(peak.ctl)}) was around ${peak.day}.`);

  // --- suggestions (history + science), capped ---
  const suggestions: Suggestion[] = [];
  if (recent.hasData && bestBuild) {
    const b = bestBuild.mix;
    const mixReliable = recent.gpsShare >= 50; // only advise on mix when we can see it
    if (mixReliable && b.gpsShare >= 50 && recent.qualityPerWeek + 0.4 < b.qualityPerWeek && recent.qualityPerWeek < 1.5) {
      suggestions.push({
        basis: 'history',
        text: `Add a weekly quality session (threshold or intervals): your best builds averaged ~${b.qualityPerWeek} hard sessions/week vs ~${recent.qualityPerWeek} lately.`,
      });
    } else if (mixReliable && recent.qualityPct < 12) {
      suggestions.push({
        basis: 'science',
        text: `Your recent mix is ~${recent.easyPct}% easy / ~${recent.qualityPct}% quality — the evidence favors ~80/20, so a weekly tempo or interval session would help.`,
      });
    }
    if (mixReliable && recent.easyPct < 65) {
      suggestions.push({
        basis: 'science',
        text: `Keep most volume easy (~80%): you're at ~${recent.easyPct}% easy lately — slow the easy days or add easy aerobic miles so the hard days land harder.`,
      });
    }
    if (b.avgWeeklyMiles > 0 && recent.avgWeeklyMiles < b.avgWeeklyMiles * 0.75) {
      suggestions.push({
        basis: 'history',
        text: `Your productive builds ran ~${b.avgWeeklyMiles} mi/week; you're ~${recent.avgWeeklyMiles} lately — build gradually (about +10%/week) toward that range.`,
      });
    }
    if (recent.longRuns === 0 && b.longRuns > 0) {
      suggestions.push({
        basis: 'history',
        text: `Reintroduce a weekly long run — they were a staple of your strongest blocks (up to ${bestBuild.longestRunMiles} mi).`,
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
    bestBuild,
    recent,
    baseline: { medianWeeklyMiles },
    observations,
    suggestions: suggestions.slice(0, 3),
  };
}
