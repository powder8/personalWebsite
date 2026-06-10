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

const LONG_RUN_CAP_MILES = 22;

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
  zones: PaceZones,
  rationale = '',
): PlannedWeek {
  const weeklyMiles = metersToMiles(week.targetVolumeMeters);

  // 1) Long run.
  const longMiles = roundMiles(Math.min(weeklyMiles * template.longRunFraction, LONG_RUN_CAP_MILES));
  const remaining = Math.max(0, weeklyMiles - longMiles);

  // 2) Distribute the remainder across non-long running days by weight.
  const distributed = template.days.filter((d) => d.runType !== 'long' && d.runType !== 'rest');
  const totalWeight = distributed.reduce((s, d) => s + d.volumeWeight, 0) || 1;

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

    const miles = roundMiles((remaining * dt.volumeWeight) / totalWeight);

    if (dt.runType === 'quality' && dt.quality) {
      const wuCd = warmupCooldownMiles(miles);
      return {
        ...base,
        runType: 'quality',
        zone: dt.quality.zone,
        distanceMeters: milesToMeters(miles),
        warmup: `${wuCd} mi easy + drills/strides`,
        cooldown: `${wuCd} mi easy`,
        segments: qualitySegments(miles, dt.quality.zone, zones),
        description: qualityDescription(miles, dt.quality.zone, zones),
      };
    }

    const zone = zoneForRunType(dt.runType)!;
    return {
      ...base,
      runType: dt.runType,
      zone,
      distanceMeters: milesToMeters(miles),
      description: `${cap(ZONE_LABEL[zone])} run, ${miles} mi @ ${paceRangeLabel(zones.zones[zone])}${
        base.optionalStrides ? '. 4–6 × 20" strides if feeling good' : ''
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

/**
 * Structured, prescriptive segments per quality type — not a single lump:
 *  - interval (VO2): ~1-mi reps with 2–3' jog recoveries
 *  - rep (speed): 400m reps with full-recovery jogs
 *  - threshold: continuous tempo when short; 1-mi cruise intervals (60" rest)
 *    when the work block is 4 mi+ (Daniels cruise structure)
 *  - everything else (marathon pace, steady): continuous block
 */
function qualitySegments(dayMiles: number, zone: ZoneKey, zones: PaceZones): WorkoutSegment[] {
  const wuCd = warmupCooldownMiles(dayMiles);
  const workMiles = roundMiles(Math.max(0, dayMiles - 2 * wuCd));
  const paceNote = paceRangeLabel(zones.zones[zone]);

  let work: WorkoutSegment;
  if (zone === 'interval') {
    const repMiles = workMiles >= 4 ? 1 : 0.75;
    const reps = Math.max(3, Math.round(workMiles / repMiles));
    work = {
      role: 'work',
      zone,
      reps,
      repMeters: milesToMeters(repMiles),
      restSeconds: 150,
      note: `${reps} × ${repMiles} mi @ ${paceNote} · 2–3 min easy jog between`,
    };
  } else if (zone === 'rep') {
    const reps = Math.min(12, Math.max(6, Math.round(workMiles / 0.25)));
    work = {
      role: 'work',
      zone,
      reps,
      repMeters: 400,
      restSeconds: 200,
      note: `${reps} × 400m @ ${paceNote} · full recovery (jog until fresh)`,
    };
  } else if (zone === 'threshold' && workMiles >= 4) {
    const reps = Math.round(workMiles);
    work = {
      role: 'work',
      zone,
      reps,
      repMeters: milesToMeters(1),
      restSeconds: 60,
      note: `${reps} × 1 mi @ ${paceNote} · 60s rest (cruise intervals)`,
    };
  } else {
    work = {
      role: 'work',
      zone,
      distanceMeters: milesToMeters(workMiles),
      note: `${workMiles} mi continuous @ ${paceNote}`,
    };
  }

  return [
    {
      role: 'warmup',
      zone: 'easy',
      distanceMeters: milesToMeters(wuCd),
      note: `${wuCd} mi easy @ ${paceRangeLabel(zones.zones.easy)}, then drills + 4 × 20" strides`,
    },
    work,
    {
      role: 'cooldown',
      zone: 'easy',
      distanceMeters: milesToMeters(wuCd),
      note: `${wuCd} mi very easy — let the heart rate come down`,
    },
  ];
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
      note: `${finish} mi easy to finish — controlled, leave a bit on the table`,
    },
  ];
}

function qualityDescription(dayMiles: number, zone: ZoneKey, zones: PaceZones): string {
  const wuCd = warmupCooldownMiles(dayMiles);
  const workMiles = roundMiles(Math.max(0, dayMiles - 2 * wuCd));
  return `${cap(ZONE_LABEL[zone])} workout — ${wuCd} mi w/u, ~${workMiles} mi @ ${paceRangeLabel(
    zones.zones[zone],
  )}, ${wuCd} mi c/d (${dayMiles} mi total)`;
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
    )}. Stay controlled — leave a bit on the table.`;
  }
  return `Long run ${miles} mi @ ${paceRangeLabel(zones.zones[embeddedZone])}, relaxed aerobic effort.`;
}

function defaultRationale(phase: PlannedWeek['phase'], weeksToRace: number, longMiles: number): string {
  const head = {
    base: 'Base week — build aerobic volume and consistency.',
    build: 'Build week — sharpen threshold/interval fitness while volume ramps.',
    peak: 'Peak week — highest load; long runs touch marathon pace.',
    taper: 'Taper — reduce volume, keep a touch of intensity, arrive fresh.',
  }[phase];
  return `${head} ${weeksToRace} week(s) to race. Long run ${longMiles} mi. Consistency over heroics — leave a bit on the table so you recover for the next key session.`;
}

function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

// Re-exported for callers that want the raw pace number.
export { midpoint, secPerKmToMinPerMile };
