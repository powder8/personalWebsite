/**
 * Generate one week's concrete SWIM sessions — the swim-side twin of
 * `bikeGenerate.ts#generateBikeWeek` and `generate.ts#generateWeek`. Same
 * skeleton, a third currency:
 *
 *   running  distributes MILES across days, days are distance @ pace
 *   cycling  distributes  TSS  across days, days are duration @ power
 *   swimming distributes sTSS  across days, days are METRES  @ CSS pace
 *
 * The distribution algorithm mirrors the run/bike generators exactly: the long
 * swim takes `longRunFraction` (here the long-SWIM fraction) of the week's sTSS
 * (capped); the remainder splits across the other swim days by `volumeWeight`,
 * consolidating away shares too small to be worth a session. Each day's sTSS
 * share is converted to METRES via its target zone's IF and the athlete's CSS:
 *
 *     duration = sTSS / (IF² × 100) × 3600      [seconds]   (shared kernel)
 *     metres   = (CSS × IF) × duration                       (speed × time)
 *
 * so `stss({ cssMetersPerSec, distanceMeters, durationSeconds })` recovers the
 * day's sTSS exactly — the metres ARE the sTSS in the swim currency.
 *
 * Quality days delegate the structured warm-up → main set → cool-down to the
 * discipline strategy (`swimStrategy.buildQualitySegments`, CSS-relative interval
 * sets in metres). TECHNIQUE days — swim's first-class differentiator (high
 * time-yield when the stroke is the limiter, swim-foundation-spec §5) — are built
 * from `buildSwimTechniqueSegments` (drills by frequency, not load). Aerobic /
 * recovery days are one steady CSS-relative block.
 *
 * Pure and DB-free (no `server-only`), like `generate.ts` / `bikeGenerate.ts`.
 */
import type {
  PlannedWeek,
  PlannedDay,
  WeekTemplate,
  SwimZones,
  SwimZoneKey,
  SwimRange,
  TrainingZones,
  WorkoutSegment,
  RunType,
} from './types';
import type { WeekPlan } from './periodize';
import type { DisciplineStrategy } from './strategy';
import { addDays } from '../dates';
import { isSwimZones, swimPaceLabel } from './swimZonesLogic';
import { buildSwimTechniqueSegments } from './swimWorkoutsLogic';
import { durationSecondsFromTss } from './bikeGenerate';
import { zoneIf } from '../loadCurrencyLogic';

// --- coach sniff-test floors (the sTSS/metres analog of the running floors) ---

/**
 * Cap the long swim so a huge weekly sTSS doesn't prescribe a 6 km pool grind:
 * ~90 sTSS is a ~4–5 km steady aerobic pull at CSS+, the practical ceiling for
 * the cohort's pool time.
 */
const LONG_SWIM_CAP_TSS = 90;
/** No prescribed swim below this — tiny shares consolidate into fewer real swims. */
const MIN_SWIM_TSS = 8;
/** A "quality" session needs room for warm-up + main set + cool-down; below this it's just a swim. */
const MIN_QUALITY_TSS = 15;

/**
 * IF used to size the LONG swim. A shade above pure aerobic (0.65) because a
 * coach's long swim carries some steady CSS+ pulling, not just cruise; keeps the
 * prescribed pool time realistic rather than inflated.
 */
const LONG_SWIM_IF = 0.68;

function clampNum(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
/** Round metres to a pool-realistic 25 m granularity. */
function round25(m: number): number {
  return Math.max(0, Math.round(m / 25) * 25);
}

/**
 * sTSS → session METRES at a target intensity factor, given the athlete's CSS.
 * duration = sTSS/(IF²·100)·3600; metres = speed × duration, speed = CSS × IF.
 * Inverts `stss()` so the metres price back to exactly this sTSS.
 */
export function metersFromStss(stss: number, intensityFactor: number, cssMetersPerSec: number): number {
  if (!(stss > 0) || !(intensityFactor > 0) || !(cssMetersPerSec > 0)) return 0;
  const durationSeconds = durationSecondsFromTss(stss, intensityFactor);
  return cssMetersPerSec * intensityFactor * durationSeconds;
}

/** Warm-up (and cool-down) metres for a swim of `totalMeters`, scaled + bounded. */
function warmupCooldownMeters(totalMeters: number): number {
  return round25(clampNum(totalMeters * 0.2, 100, 800));
}

/** The primary swim zone for a non-quality swim day. */
function zoneForSwimType(rt: RunType): SwimZoneKey | null {
  switch (rt) {
    case 'recovery':
      return 'recovery';
    case 'easy':
    case 'maintenance':
      return 'aerobic';
    case 'long':
      return 'aerobic';
    case 'rest':
    case 'cross_train':
    case 'race':
      return null;
    default:
      return 'aerobic';
  }
}

const ZONE_LABEL: Record<SwimZoneKey, string> = {
  recovery: 'recovery',
  aerobic: 'aerobic',
  threshold: 'threshold',
  vo2max: 'VO2max',
  sprint: 'sprint',
};

/** The sec/100 m pace label for a swim zone, e.g. "1:35–1:42 /100m". */
function targetLabel(zones: SwimZones, key: SwimZoneKey): string {
  return swimPaceLabel(zones.zones[key]);
}
/** Pace bounds for a segment, taken from the athlete's own CSS-relative zone. */
function paceTargets(zones: SwimZones, key: SwimZoneKey): Pick<WorkoutSegment, 'targetFastSecPer100' | 'targetSlowSecPer100'> {
  const r: SwimRange = zones.zones[key];
  return { targetFastSecPer100: r.fastSecPer100, targetSlowSecPer100: r.slowSecPer100 };
}

export function generateSwimWeek(
  week: WeekPlan,
  template: WeekTemplate,
  trainingZones: TrainingZones,
  rationale = '',
  strategy: DisciplineStrategy,
): PlannedWeek {
  if (!isSwimZones(trainingZones)) {
    throw new Error('swimGenerate: expected swim zones on the swimming discipline');
  }
  const zones = trainingZones;
  const css = zones.cssMetersPerSec;

  // The week's sTSS budget — the discipline-generic load the periodizer ramped.
  const weeklyStss = week.loadUnit === 'tss' ? week.targetLoad : week.targetVolumeMeters;

  // 1) Long swim — a fraction of the week's sTSS, floored + capped.
  let longStss = Math.round(
    Math.min(Math.max(weeklyStss * template.longRunFraction, Math.min(MIN_SWIM_TSS, weeklyStss)), LONG_SWIM_CAP_TSS),
  );
  let remaining = Math.max(0, weeklyStss - longStss);
  // If what's left can't make even one meaningful swim, the week IS the long swim.
  if (remaining < MIN_SWIM_TSS) {
    longStss = Math.round(weeklyStss);
    remaining = 0;
  }

  // 2) Distribute the remainder across non-long swim days by weight, consolidating
  //    away shares too small to be worth suiting up for (mirrors run/bike).
  let active =
    remaining >= MIN_SWIM_TSS ? template.days.filter((d) => d.runType !== 'long' && d.runType !== 'rest') : [];
  const allocFor = (set: typeof active) => {
    const tw = set.reduce((s, d) => s + d.volumeWeight, 0) || 1;
    return new Map(set.map((d) => [d, (remaining * d.volumeWeight) / tw]));
  };
  let alloc = allocFor(active);
  while (active.length > 1) {
    const smallest = [...alloc.entries()].sort((a, b) => a[1] - b[1])[0];
    if (smallest[1] >= MIN_SWIM_TSS) break;
    active = active.filter((d) => d !== smallest[0]);
    alloc = allocFor(active);
  }

  let totalMeters = 0;

  const days: PlannedDay[] = template.days.map((dt) => {
    const day = addDays(week.weekStart, dt.dow);
    const base = { day, dow: dt.dow, pinned: false, optionalStrides: dt.optionalStrides ?? false };

    if (dt.runType === 'rest') {
      return { ...base, runType: 'rest' as const, zone: null, distanceMeters: 0, durationSeconds: 0, targetLoadTss: 0, description: 'Rest day — out of the pool.' };
    }

    if (dt.runType === 'long') {
      const meters = round25(metersFromStss(longStss, LONG_SWIM_IF, css));
      const durationSeconds = Math.round(durationSecondsFromTss(longStss, LONG_SWIM_IF));
      totalMeters += meters;
      return {
        ...base,
        runType: 'long' as const,
        zone: 'aerobic',
        distanceMeters: meters,
        durationSeconds,
        targetLoadTss: longStss,
        segments: longSwimSegments(meters, template.phase, zones),
        description: longSwimDescription(meters, longStss, template.phase, zones),
      };
    }

    // Consolidated away (share below the minimum meaningful swim) → rest.
    if (!alloc.has(dt)) {
      return { ...base, runType: 'rest' as const, zone: null, distanceMeters: 0, durationSeconds: 0, targetLoadTss: 0, description: 'Rest day — out of the pool.' };
    }
    const dayStss = Math.round(alloc.get(dt)!);

    // A TECHNIQUE day (swim's first-class differentiator): drills by frequency,
    // swum easy. Priced at recovery IF, built from the drill catalogue.
    if (dt.runType === 'quality' && dt.quality?.technique) {
      const meters = round25(metersFromStss(dayStss, zoneIf('recovery'), css));
      const durationSeconds = Math.round(durationSecondsFromTss(dayStss, zoneIf('recovery')));
      const seed = week.weeksToRace + dt.dow;
      totalMeters += meters;
      return {
        ...base,
        runType: 'quality' as const,
        zone: 'recovery',
        distanceMeters: meters,
        durationSeconds,
        targetLoadTss: dayStss,
        segments: buildSwimTechniqueSegments(meters, zones, seed),
        description: techniqueDescription(meters, zones),
      };
    }

    // A real quality session needs room for warm-up + main set + cool-down; below
    // the floor it degrades to an aerobic swim instead.
    if (dt.runType === 'quality' && dt.quality && dayStss >= MIN_QUALITY_TSS) {
      const qZone = dt.quality.zone as SwimZoneKey;
      const meters = round25(metersFromStss(dayStss, zoneIf(qZone), css));
      const durationSeconds = Math.round(durationSecondsFromTss(dayStss, zoneIf(qZone)));
      const wuCd = warmupCooldownMeters(meters);
      const workMeters = round25(Math.max(0, meters - 2 * wuCd));
      // Deterministic variety: rotate the template by week + day.
      const seed = week.weeksToRace + dt.dow;
      totalMeters += meters;
      return {
        ...base,
        runType: 'quality' as const,
        zone: qZone,
        distanceMeters: meters,
        durationSeconds,
        targetLoadTss: dayStss,
        warmup: `${wuCd} m easy mixed + drill build to ${targetLabel(zones, 'recovery')}`,
        cooldown: `${wuCd} m easy @ ${targetLabel(zones, 'recovery')}`,
        segments: strategy.buildQualitySegments(meters, qZone, zones, workMeters, wuCd, seed),
        description: strategy.buildQualityDescription(meters, qZone, zones, workMeters, wuCd, seed),
      };
    }

    // Aerobic / recovery fill (or a quality day too small to be quality): one
    // steady CSS-relative block.
    const zone = dt.runType === 'quality' ? 'aerobic' : zoneForSwimType(dt.runType)!;
    const meters = round25(metersFromStss(dayStss, zoneIf(zone), css));
    const durationSeconds = Math.round(durationSecondsFromTss(dayStss, zoneIf(zone)));
    totalMeters += meters;
    return {
      ...base,
      runType: dt.runType === 'quality' ? ('easy' as const) : dt.runType,
      zone,
      distanceMeters: meters,
      durationSeconds,
      targetLoadTss: dayStss,
      segments: [
        {
          role: 'work' as const,
          zone,
          distanceMeters: meters,
          ...paceTargets(zones, zone),
          note: `${meters} m continuous @ ${targetLabel(zones, zone)} — steady aerobic swim`,
        },
      ],
      description: `${cap(ZONE_LABEL[zone])} swim, ${meters} m @ ${targetLabel(zones, zone)} — steady aerobic effort`,
    };
  });

  return {
    weekStart: week.weekStart,
    phase: template.phase,
    cycle: week.cycle,
    targetVolumeMeters: totalMeters,
    targetLoadTss: Math.round(weeklyStss),
    days,
    rationale: rationale || defaultRationale(template.phase, week.weeksToRace, Math.round(weeklyStss)),
  };
}

/**
 * Long-swim segments: an easy mixed lead-in, a long CSS+ aerobic pull in the
 * middle (build/peak, long enough), an easy finish — the swim-side twin of the
 * running long run's marathon-pace segments and the bike long ride's sweet-spot.
 */
function longSwimSegments(
  totalMeters: number,
  phase: PlannedWeek['phase'],
  zones: SwimZones,
): WorkoutSegment[] | undefined {
  if (!((phase === 'build' || phase === 'peak') && totalMeters >= 2000)) return undefined;
  const lead = round25(totalMeters * 0.25);
  const finish = round25(totalMeters * 0.15);
  const pullTotal = Math.max(0, totalMeters - lead - finish);
  const reps = pullTotal >= 2400 ? 4 : 3;
  const repMeters = round25(pullTotal / reps);
  return [
    {
      role: 'warmup',
      zone: 'recovery',
      distanceMeters: lead,
      ...paceTargets(zones, 'recovery'),
      note: `${lead} m easy mixed swim + drills @ ${targetLabel(zones, 'recovery')} to open up`,
    },
    {
      role: 'work',
      zone: 'aerobic',
      reps,
      repMeters,
      restSeconds: 20,
      ...paceTargets(zones, 'aerobic'),
      note: `${reps} × ${repMeters} m @ ${targetLabel(zones, 'aerobic')} · 20 s rest — long steady pulls, distance base`,
    },
    {
      role: 'cooldown',
      zone: 'recovery',
      distanceMeters: finish,
      ...paceTargets(zones, 'recovery'),
      note: `${finish} m easy @ ${targetLabel(zones, 'recovery')} to finish`,
    },
  ];
}

function longSwimDescription(
  totalMeters: number,
  stss: number,
  phase: PlannedWeek['phase'],
  zones: SwimZones,
): string {
  if ((phase === 'build' || phase === 'peak') && totalMeters >= 2000) {
    return `Long swim ${totalMeters} m (~${stss} sTSS): easy aerobic with long CSS+ pulls @ ${targetLabel(
      zones,
      'aerobic',
    )}. Relax the stroke, stay long, breathe smooth.`;
  }
  return `Long swim ${totalMeters} m (~${stss} sTSS) @ ${targetLabel(zones, 'aerobic')}, relaxed aerobic pulling.`;
}

function techniqueDescription(totalMeters: number, zones: SwimZones): string {
  return `Technique swim ${totalMeters} m: warm-up, rotated drill sets @ ${targetLabel(
    zones,
    'recovery',
  )} (by feel, not the clock), easy finish. Skill work — frequency over intensity.`;
}

function defaultRationale(phase: PlannedWeek['phase'], weeksToRace: number, weeklyStss: number): string {
  const head = {
    base: 'Base week — build aerobic base and drill the stroke; technique is the highest time-yield limiter.',
    build: 'Build week — raise CSS with threshold sets, sharpen above it with VO2 as volume ramps.',
    peak: 'Peak week — highest load; threshold + VO2 on top of a big long pull.',
    taper: 'Taper — cut volume, keep a little CSS work, hold the feel for the water.',
  }[phase];
  return `${head} ${weeksToRace} week(s) to race. Weekly load ~${weeklyStss} sTSS. Consistency over heroics — hold CSS pace, keep the catch.`;
}
