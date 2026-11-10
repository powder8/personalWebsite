/**
 * Body assessment: turn the day-by-day vitals walk + training load into a
 * read of what is going on NOW. Pure: no DB, no clock.
 *
 *  - an EPISODE is a sustained run of off days (not one bad night);
 *  - its KIND says what best explains it: illness (illness-specific markers,
 *    or strain that training doesn't explain), overreaching (it follows a load
 *    spike), or under-recovery (short sleep / high life stress);
 *  - PRIMED is the opposite read: steady, in-range signals on consistent
 *    training, i.e. room to do a little more.
 */
import { dayNumber, diffDays } from '../dates';
import type { DailyReading } from '../types';
import { VITALS, VITAL_KEYS, walkVitals, type BodyDay, type VitalKey, type VitalSeries, type WalkOptions, type WalkedEpisode } from './vitals';

export type EpisodeKind = 'illness' | 'overreaching' | 'under_recovered' | 'strain';

export interface LoadContext {
  /** Training load over the last 7 days. */
  acute7: number;
  /** Average weekly load over the 28 days before that. */
  usualWeekly: number | null;
  /** acute7 / usualWeekly. >1.3 = a clear step up; <0.6 = well below usual. */
  ratio: number | null;
  /** Days with any training in the last 7 / 14. */
  activeDays7: number;
  activeDays14: number;
}

/** Load in a window, and the ratio of the last week to the athlete's usual week. */
export function loadContext(loads: DailyReading[], asOf: string): LoadContext {
  const end = dayNumber(asOf);
  let acute7 = 0;
  let prior28 = 0;
  const active = new Set<number>();
  const priorActive = new Set<number>();
  for (const l of loads) {
    if (!(l.value > 0)) continue;
    const dn = dayNumber(l.day);
    const age = end - dn;
    if (age < 0) continue;
    if (age < 7) acute7 += l.value;
    else if (age < 35) {
      prior28 += l.value;
      priorActive.add(dn);
    }
    if (age < 14) active.add(dn);
  }
  // A "usual week" needs real history behind it, or the ratio is noise.
  const usualWeekly = priorActive.size >= 6 ? prior28 / 4 : null;
  return {
    acute7,
    usualWeekly,
    ratio: usualWeekly && usualWeekly > 0 ? acute7 / usualWeekly : null,
    activeDays7: [...active].filter((dn) => end - dn < 7).length,
    activeDays14: active.size,
  };
}

export interface DetectedEpisode {
  kind: EpisodeKind;
  startedOn: string;
  /** Most recent day inside the episode. */
  lastOffDay: string;
  spanDays: number;
  /** Observed days inside the episode. */
  offDays: number;
  /** Illness-specific markers that are clearly raised across the episode. */
  markers: VitalKey[];
  /** Persistence of the composite right now (standard units; ~3.6 triggers). */
  recentScore: number;
  severity: 'mild' | 'moderate' | 'high';
  /** Load ratio in the week leading into the episode (did training cause this?). */
  leadInLoadRatio: number | null;
}

export interface PastEpisode {
  kind: EpisodeKind;
  startedOn: string;
  endedOn: string;
  days: number;
  peakStrain: number;
}

export interface SubjectiveContext {
  /** Mean of recent check-ins (last 5 days), when present. */
  sleepQuality?: number | null;
  lifeStress?: number | null;
  energy?: number | null;
  soreness?: number | null;
}

export interface BodyAssessment {
  asOf: string;
  /** Most recent day with any vital, and whether it is too old to act on. */
  dataDay: string | null;
  stale: boolean;
  /** Days with a usable baseline in the last 14: below ~5 we can't judge. */
  coverage14: number;
  latest: BodyDay | null;
  days: BodyDay[];
  episode: DetectedEpisode | null;
  /** Observed days since the last episode ended (large if there never was one). */
  clearStreak: number;
  load: LoadContext;
  primed: boolean;
  history: PastEpisode[];
}

const STALE_AFTER = 2; // days without data before we stop calling it current

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** What best explains a run of off days. */
function classify(
  days: BodyDay[],
  startedOn: string,
  spanDays: number,
  loads: DailyReading[],
  subjective: SubjectiveContext,
): { kind: EpisodeKind; markers: VitalKey[]; leadIn: number | null } {
  // A marker counts when it is raised on AVERAGE across the episode, not on one day.
  const markers = VITAL_KEYS.filter((k) => {
    if (!VITALS[k].illnessMarker) return false;
    const bads = days.map((d) => d.vitals[k]?.bad).filter((b): b is number => b != null);
    const m = mean(bads);
    // Significant for the number of days seen (about 2.5 standard errors), and
    // a real shift, so a noisy night or two can't label an episode "illness".
    const bar = bads.length < 3 || k === 'spo2' ? 3 : 2.5;
    return bads.length >= 2 && m != null && m >= 0.8 && m * Math.sqrt(bads.length) >= bar;
  });
  // Load in the week ending the day the episode began: did a spike precede it?
  const leadIn = loadContext(loads, startedOn).ratio;
  const sleepBad = mean(days.map((d) => d.vitals.sleep?.bad).filter((b): b is number => b != null));

  if (markers.length >= 1) return { kind: 'illness', markers, leadIn };
  if (leadIn != null && leadIn >= 1.3) return { kind: 'overreaching', markers, leadIn };
  if ((sleepBad != null && sleepBad >= 1) || (subjective.lifeStress ?? 0) >= 7 || (subjective.sleepQuality != null && subjective.sleepQuality <= 3)) {
    return { kind: 'under_recovered', markers, leadIn };
  }
  // Sustained strain that neither training nor sleep explains: most often illness.
  if (spanDays >= 4) return { kind: 'illness', markers, leadIn };
  return { kind: 'strain', markers, leadIn };
}

export function assessBody(
  series: VitalSeries,
  loads: DailyReading[],
  asOf: string,
  opts: WalkOptions & { subjective?: SubjectiveContext; daysSinceEpisodeEnd?: number | null } = {},
): BodyAssessment {
  const walk = walkVitals(series, asOf, opts);
  const days = walk.days;
  const subjective = opts.subjective ?? {};
  const latest = days[days.length - 1] ?? null;
  const dataDay = latest?.day ?? null;
  const stale = dataDay == null || diffDays(asOf, dataDay) > STALE_AFTER;
  const recent14 = days.filter((d) => diffDays(asOf, d.day) < 14);
  const coverage14 = recent14.filter((d) => d.scored >= 1).length;
  const load = loadContext(loads, asOf);
  const byDay = new Map(days.map((d) => [d.day, d]));
  const daysOf = (e: WalkedEpisode) => e.days.map((d) => byDay.get(d)!).filter(Boolean);

  let episode: DetectedEpisode | null = null;
  if (walk.active && !stale) {
    const e = walk.active;
    const eDays = daysOf(e);
    const spanDays = diffDays(asOf, e.startedOn) + 1;
    const { kind, markers, leadIn } = classify(eDays, e.startedOn, spanDays, loads, subjective);
    const recentScore = Math.max(latest?.strain3 ?? 0, latest?.strain ?? 0);
    episode = {
      kind,
      startedOn: e.startedOn,
      lastOffDay: e.days[e.days.length - 1],
      spanDays,
      offDays: e.days.length,
      markers,
      recentScore: Math.round(recentScore * 10) / 10,
      severity: recentScore >= 6 || spanDays >= 14 ? 'high' : recentScore >= 4.5 || spanDays >= 7 ? 'moderate' : 'mild',
      leadInLoadRatio: leadIn,
    };
  }

  // Observed days since the last episode ended.
  let clearStreak = 0;
  for (let i = days.length - 1; i >= 0 && !days[i].inEpisode; i--) clearStreak++;

  // --- Room to do more? Steady, in-range signals on consistent training. ---
  const last7 = recent14.filter((d) => diffDays(asOf, d.day) < 7);
  const avgBad = (k: VitalKey) => mean(last7.map((d) => d.vitals[k]?.bad).filter((b): b is number => b != null));
  const hrv7 = avgBad('hrv');
  const rhr7 = avgBad('resting_hr');
  const strain14 = mean(recent14.map((d) => d.strain).filter((s): s is number => s != null));
  const primed =
    !stale &&
    !episode &&
    coverage14 >= 10 &&
    recent14.every((d) => !d.inEpisode) &&
    last7.every((d) => d.level !== 'abnormal') &&
    recent14.filter((d) => d.level === 'abnormal').length <= 1 &&
    (strain14 ?? 9) <= 0.8 &&
    (latest?.strain7 ?? 9) <= 2 &&
    (hrv7 == null || hrv7 <= 0.5) &&
    (rhr7 == null || rhr7 <= 0.5) &&
    (hrv7 != null || rhr7 != null) &&
    load.ratio != null &&
    load.ratio >= 0.85 &&
    load.ratio <= 1.2 &&
    load.activeDays14 >= 6 &&
    (opts.daysSinceEpisodeEnd == null || opts.daysSinceEpisodeEnd >= 14) &&
    (subjective.energy == null || subjective.energy >= 5) &&
    (subjective.soreness == null || subjective.soreness <= 6);

  // --- History: every past sustained episode (3+ days). ---
  const history: PastEpisode[] = walk.episodes
    .filter((e) => e.endedOn != null && diffDays(e.endedOn, e.startedOn) + 1 >= 3)
    .map((e) => {
      const span = diffDays(e.endedOn!, e.startedOn) + 1;
      return {
        kind: classify(daysOf(e), e.startedOn, span, loads, {}).kind,
        startedOn: e.startedOn,
        endedOn: e.endedOn!,
        days: span,
        peakStrain: Math.round(e.peakStrain * 10) / 10,
      };
    });

  return { asOf, dataDay, stale, coverage14, latest, days, episode, clearStreak, load, primed, history };
}
