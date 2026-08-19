/**
 * Generate one week's concrete sessions from (week target, phase template,
 * pace zones). Deterministic: same inputs → same week.
 *
 * Distribution: the long run takes `longRunFraction` of weekly volume (capped);
 * the remainder is split across the other running days by their volumeWeight.
 * Quality days are split into warmup / work / cooldown segments, with the work
 * portion at the prescribed zone.
 */
import type {
  PlannedWeek,
  PlannedDay,
  WeekTemplate,
  PaceZones,
  TrainingZones,
  WorkoutSegment,
  ZoneKey,
  RunType,
} from './types';
import type { WeekPlan } from './periodize';
import { addDays } from '../dates';
import {
  metersToMiles,
  milesToMeters,
  paceRangeLabel,
  midpoint,
  secPerKmToMinPerMile,
} from './zones';
import type { DisciplineStrategy } from './strategy';
import { runStrategy } from './runStrategy';
import { isPaceZones } from './powerZonesLogic';
import { generateBikeWeek } from './bikeGenerate';
import { generateSwimWeek } from './swimGenerate';

const LONG_RUN_CAP_MILES = 22;

/**
 * Common-sense floors (the coach sniff test): no prescribed run shorter than
 * ~2 mi — at low weekly volume we consolidate into fewer runs instead — and no
 * "quality workout" without room for warm-up + work + cool-down.
 */
const MIN_RUN_MILES = 2;
const MIN_QUALITY_MILES = 3;

/**
 * Daniels: quality EMPHASIS depends on the goal race distance, not just the
 * phase. 5K/10K builds sharpen with I (VO2) and R work; halves live at T;
 * marathons emphasise M-pace and cruise T. The nth quality day of a week takes
 * the nth zone (cycling). 'half' mirrors the legacy defaults, so plans built
 * without a goal class are unchanged.
 */
import type { GoalClass } from './raceWindows';
const QUALITY_EMPHASIS: Record<GoalClass, Record<PlannedWeek['phase'], ZoneKey[]>> = {
  tenk_or_shorter: {
    base: ['threshold'],
    build: ['interval', 'threshold'],
    peak: ['interval', 'rep'],
    taper: ['rep'],
  },
  half: {
    base: ['threshold'],
    build: ['threshold', 'interval'],
    peak: ['threshold', 'marathon'],
    taper: ['threshold'],
  },
  marathon: {
    base: ['threshold'],
    build: ['threshold', 'marathon'],
    peak: ['marathon', 'threshold'],
    taper: ['threshold'],
  },
};

/** Human plans use half-mile granularity, not 0.3-mi oddities. */
function roundHalf(mi: number): number {
  return Math.round(mi * 2) / 2;
}

/**
 * Warmup/cooldown scale with the day's size — an elite does ~2.5 mi each on a
 * 10-mi quality day; a recreational runner does ~1 mi on a 4-mi day. Fixed
 * mileage would leave "0 mi of work" for low-volume athletes.
 */
function warmupCooldownMiles(dayMiles: number): number {
  return clampNum(Math.round(dayMiles * 0.25 * 10) / 10, 1.0, 3.0);
}

function clampNum(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

const ZONE_LABEL: Record<ZoneKey, string> = {
  recovery: 'recovery',
  easy: 'easy',
  maintenance: 'maintenance',
  marathon: 'marathon-pace',
  threshold: 'threshold',
  interval: 'interval',
  rep: 'rep',
};

function roundMiles(mi: number): number {
  return Math.round(mi * 10) / 10;
}

/** Default zone for a non-quality run type. */
function zoneForRunType(rt: RunType): ZoneKey | null {
  switch (rt) {
    case 'recovery':
      return 'recovery';
    case 'easy':
      return 'easy';
    case 'maintenance':
      return 'maintenance';
    case 'long':
      return 'easy';
    case 'rest':
    case 'cross_train':
    case 'race':
      return null;
    default:
      return 'easy';
  }
}

export function generateWeek(
  week: WeekPlan,
  template: WeekTemplate,
  zones: TrainingZones,
  rationale = '',
  goalClass?: GoalClass,
  strategy: DisciplineStrategy = runStrategy,
): PlannedWeek {
  // Cycling is a distinct currency (TSS/duration @ power) — hand off to the
  // power-side generator. Running falls through unchanged (byte-identical).
  if (strategy.discipline === 'bike') {
    return generateBikeWeek(week, template, zones, rationale, strategy);
  }
  // Swimming is a third currency (sTSS/metres @ CSS pace) — hand off to the
  // swim generator. Running still falls through unchanged (byte-identical).
  if (strategy.discipline === 'swim') {
    return generateSwimWeek(week, template, zones, rationale, strategy);
  }
  // Run path: zones must be pace-shaped (bike handed off above; swim doesn't
  // generate here yet). Asserting pace narrows out both the power and swim arms.
  if (!isPaceZones(zones)) {
    throw new Error('runStrategy: expected pace zones on the running discipline');
  }
  const weeklyMiles = metersToMiles(week.targetVolumeMeters);

  // Distance-aware quality: the nth quality day this week takes the nth
  // emphasis zone for (goal class × phase). Without a class, templates win.
  const emphasis = goalClass ? QUALITY_EMPHASIS[goalClass][template.phase] : null;
  let qualityIndex = 0;
  const qualityZoneFor = (templateZone: ZoneKey): ZoneKey =>
    emphasis ? emphasis[qualityIndex++ % emphasis.length] : templateZone;

  // 1) Long run — floored at the minimum meaningful run, capped at the week.
  let longMiles = roundHalf(
    Math.min(Math.max(weeklyMiles * template.longRunFraction, Math.min(MIN_RUN_MILES, weeklyMiles)), LONG_RUN_CAP_MILES),
  );
  let remaining = Math.max(0, weeklyMiles - longMiles);
  // If what's left can't make even one meaningful run, the week IS the long run.
  if (remaining < MIN_RUN_MILES) {
    longMiles = roundHalf(weeklyMiles);
    remaining = 0;
  }

  // 2) Distribute the remainder across non-long running days by weight —
  //    CONSOLIDATING away days whose share would be too short to be worth
  //    lacing up for. A 0.3 mi "run" fails the coach sniff test: at low
  //    volume, fewer meaningful runs beat many micro-runs. Days dropped here
  //    become rest; their volume flows to the surviving days.
  let active =
    remaining >= MIN_RUN_MILES ? template.days.filter((d) => d.runType !== 'long' && d.runType !== 'rest') : [];
  const allocFor = (set: typeof active) => {
    const tw = set.reduce((s, d) => s + d.volumeWeight, 0) || 1;
    return new Map(set.map((d) => [d, (remaining * d.volumeWeight) / tw]));
  };
  let alloc = allocFor(active);
  while (active.length > 1) {
    const smallest = [...alloc.entries()].sort((a, b) => a[1] - b[1])[0];
    if (smallest[1] >= MIN_RUN_MILES) break;
    active = active.filter((d) => d !== smallest[0]);
    alloc = allocFor(active);
  }

  const days: PlannedDay[] = template.days.map((dt) => {
    const day = addDays(week.weekStart, dt.dow);
    const base = {
      day,
      dow: dt.dow,
      pinned: false,
      optionalStrides: dt.optionalStrides ?? false,
    };

    if (dt.runType === 'rest') {
      return { ...base, runType: 'rest', zone: null, distanceMeters: 0, description: 'Rest day.' };
    }

    if (dt.runType === 'long') {
      const zone = template.phase === 'peak' || template.phase === 'build' ? 'marathon' : 'easy';
      return {
        ...base,
        runType: 'long',
        zone: 'easy',
        distanceMeters: milesToMeters(longMiles),
        segments: longRunSegments(longMiles, template.phase, zones),
        description: longRunDescription(longMiles, template.phase, zones, zone),
      };
    }

    // Consolidated away (share was below the minimum meaningful run) → rest.
    if (!alloc.has(dt)) {
      return { ...base, runType: 'rest' as const, zone: null, distanceMeters: 0, description: 'Rest day.' };
    }
    const miles = roundHalf(alloc.get(dt)!);

    // A real quality session needs room for warm-up + work + cool-down; below
    // ~MIN_QUALITY_MILES it degrades to junk — run it as a steady/easy day.
    if (dt.runType === 'quality' && dt.quality && miles >= MIN_QUALITY_MILES) {
      // Running templates only ever carry pace `ZoneKey`s (the union widened to
      // admit power zones for the bike arm, which never reaches here).
      const qZone = qualityZoneFor(dt.quality.zone as ZoneKey);
      const wuCd = warmupCooldownMiles(miles);
      const workMiles = roundMiles(Math.max(0, miles - 2 * wuCd));
      // Deterministic variety: rotate the template by week + day so an athlete
      // isn't handed the identical session every quality day.
      const seed = week.weeksToRace + dt.dow;
      return {
        ...base,
        runType: 'quality',
        zone: qZone,
        distanceMeters: milesToMeters(miles),
        warmup: `${wuCd} mi easy + drills/strides`,
        cooldown: `${wuCd} mi easy`,
        segments: strategy.buildQualitySegments(miles, qZone, zones, workMiles, wuCd, seed),
        description: strategy.buildQualityDescription(miles, qZone, zones, workMiles, wuCd, seed),
      };
    }

    const zone = dt.runType === 'quality' ? 'easy' : zoneForRunType(dt.runType)!;
    return {
      ...base,
      runType: dt.runType === 'quality' ? 'easy' : dt.runType,
      zone,
      distanceMeters: milesToMeters(miles),
      description: `${cap(ZONE_LABEL[zone])} run, ${miles} mi @ ${paceRangeLabel(zones.zones[zone])}${
        base.optionalStrides ? '. 4-6 × 20" strides if feeling good' : ''
      }`,
    };
  });

  return {
    weekStart: week.weekStart,
    phase: template.phase,
    cycle: week.cycle,
    targetVolumeMeters: week.targetVolumeMeters,
    days,
    rationale: rationale || defaultRationale(template.phase, week.weeksToRace, longMiles),
  };
}

/** Long-run segments: easy lead-in, marathon-pace blocks (build/peak ≥12 mi), easy finish. */
function longRunSegments(
  miles: number,
  phase: PlannedWeek['phase'],
  zones: PaceZones,
): WorkoutSegment[] | undefined {
  if (!((phase === 'build' || phase === 'peak') && miles >= 12)) return undefined;
  const lead = roundMiles(miles * 0.4);
  const finish = roundMiles(miles * 0.2);
  const mpTotal = roundMiles(Math.max(0, miles - lead - finish));
  const blocks = mpTotal >= 6 ? 3 : 2;
  const blockMiles = roundMiles(mpTotal / blocks);
  return [
    {
      role: 'warmup',
      zone: 'easy',
      distanceMeters: milesToMeters(lead),
      note: `${lead} mi relaxed @ ${paceRangeLabel(zones.zones.easy)}`,
    },
    {
      role: 'work',
      zone: 'marathon',
      reps: blocks,
      repMeters: milesToMeters(blockMiles),
      note: `${blocks} × ${blockMiles} mi @ ${paceRangeLabel(zones.zones.marathon)} · ½ mi easy float between`,
    },
    {
      role: 'cooldown',
      zone: 'easy',
      distanceMeters: milesToMeters(finish),
      note: `${finish} mi easy to finish, controlled, leave a bit on the table`,
    },
  ];
}

function longRunDescription(
  miles: number,
  phase: PlannedWeek['phase'],
  zones: PaceZones,
  embeddedZone: ZoneKey,
): string {
  if ((phase === 'build' || phase === 'peak') && miles >= 12) {
    return `Long run ${miles} mi: easy aerobic with marathon-pace segments @ ${paceRangeLabel(
      zones.zones.marathon,
    )}. Stay controlled, leave a bit on the table.`;
  }
  return `Long run ${miles} mi @ ${paceRangeLabel(zones.zones[embeddedZone])}, relaxed aerobic effort.`;
}

function defaultRationale(phase: PlannedWeek['phase'], weeksToRace: number, longMiles: number): string {
  const head = {
    base: 'Base week, build aerobic volume and consistency.',
    build: 'Build week, sharpen threshold/interval fitness while volume ramps.',
    peak: 'Peak week, highest load; long runs touch marathon pace.',
    taper: 'Taper, reduce volume, keep a touch of intensity, arrive fresh.',
  }[phase];
  return `${head} ${weeksToRace} week(s) to race. Long run ${longMiles} mi. Consistency over heroics, leave a bit on the table so you recover for the next key session.`;
}

function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

// Re-exported for callers that want the raw pace number.
export { midpoint, secPerKmToMinPerMile };
