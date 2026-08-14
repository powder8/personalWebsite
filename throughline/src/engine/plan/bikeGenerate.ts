/**
 * Generate one week's concrete CYCLING sessions — the power-side twin of
 * `generate.ts#generateWeek`. Same skeleton, different currency:
 *
 *   running  distributes MILES  across days, days are distance @ pace
 *   cycling  distributes  TSS   across days, days are duration @ power
 *
 * The distribution algorithm mirrors the running generator exactly: the long
 * ride takes `longRunFraction` (here the long-RIDE fraction) of the week's TSS
 * (capped); the remainder splits across the other ride days by `volumeWeight`,
 * consolidating away shares too small to be worth a ride. Each day's TSS share is
 * converted to a DURATION via its target zone's IF (cycling-engine-spec §4.3):
 *
 *     duration = TSS / (IF² × 100) × 3600      [seconds]
 *
 * Quality days delegate the structured warm-up → main set → cool-down to the
 * discipline strategy (`bikeStrategy.buildQualitySegments`, which speaks MINUTES
 * and power). Endurance/recovery days are one steady block; the long ride embeds
 * sweet-spot blocks in build/peak (the long-run marathon-pace analog).
 *
 * Pure and DB-free (no `server-only`), like `generate.ts`.
 */
import type {
  PlannedWeek,
  PlannedDay,
  WeekTemplate,
  PowerZones,
  PowerZoneKey,
  PowerRange,
  TrainingZones,
  WorkoutSegment,
  RunType,
} from './types';
import type { WeekPlan } from './periodize';
import type { DisciplineStrategy } from './strategy';
import { addDays } from '../dates';
import { isPowerZones, wattsLabel, bpmLabel } from './powerZonesLogic';
import { zoneIf } from '../loadCurrencyLogic';

// --- coach sniff-test floors (the TSS/duration analog of the running floors) ---

/**
 * Cap the long ride so a huge weekly TSS doesn't prescribe a 6-hour ride: ~300
 * TSS is a ~4–4.5 h steady endurance ride, the practical ceiling for the cohort.
 */
const LONG_RIDE_CAP_TSS = 300;
/** No prescribed ride below this — tiny shares consolidate into fewer real rides. */
const MIN_RIDE_TSS = 15;
/** A "quality" session needs room for warm-up + work + cool-down below this it's just a ride. */
const MIN_QUALITY_TSS = 30;

/**
 * IF used to size the LONG ride's duration. A shade above pure Z2 endurance
 * (0.65) because a coach's long ride carries some tempo/sweet-spot; keeps the
 * prescribed saddle time realistic rather than inflated.
 */
const LONG_RIDE_IF = 0.7;

function clampNum(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** TSS → session duration (seconds) at a given intensity factor (spec §4.3). */
export function durationSecondsFromTss(tss: number, intensityFactor: number): number {
  if (!(tss > 0) || !(intensityFactor > 0)) return 0;
  return (tss / (intensityFactor * intensityFactor * 100)) * 3600;
}

/** Round to whole minutes — human plans read "45 min", not "44.7 min". */
function toMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}

/** Warm-up (and cool-down) length for a ride of `totalMin`, scaled + bounded. */
function warmupCooldownMinutes(totalMin: number): number {
  return clampNum(Math.round(totalMin * 0.15), 8, 20);
}

/** The primary power zone for a non-quality bike day. */
function zoneForBikeType(rt: RunType): PowerZoneKey | null {
  switch (rt) {
    case 'recovery':
      return 'recovery';
    case 'easy':
    case 'maintenance':
      return 'endurance';
    case 'long':
      return 'endurance';
    case 'rest':
    case 'cross_train':
    case 'race':
      return null;
    default:
      return 'endurance';
  }
}

const ZONE_LABEL: Record<PowerZoneKey, string> = {
  recovery: 'recovery',
  endurance: 'endurance',
  tempo: 'tempo',
  sweetspot: 'sweet-spot',
  threshold: 'threshold',
  vo2max: 'VO2max',
  anaerobic: 'anaerobic',
  sprint: 'neuromuscular',
};

/** Target label for a zone: watt band with a power meter, else the %LTHR bpm band. */
function targetLabel(zones: PowerZones, key: PowerZoneKey): string {
  if (zones.zones) return wattsLabel(zones.zones[key]);
  const hr = zones.hrZones?.[key];
  return hr ? bpmLabel(hr) : key;
}
/** Watt bounds for a segment, present only with a power meter. */
function wattTargets(zones: PowerZones, key: PowerZoneKey): Pick<WorkoutSegment, 'targetLoWatts' | 'targetHiWatts'> {
  const r: PowerRange | undefined = zones.zones?.[key];
  return r ? { targetLoWatts: r.loWatts, targetHiWatts: r.hiWatts } : {};
}

export function generateBikeWeek(
  week: WeekPlan,
  template: WeekTemplate,
  trainingZones: TrainingZones,
  rationale = '',
  strategy: DisciplineStrategy,
): PlannedWeek {
  if (!isPowerZones(trainingZones)) {
    throw new Error('bikeGenerate: expected power zones on the cycling discipline');
  }
  const zones = trainingZones;

  // The week's TSS budget — the discipline-generic load the periodizer ramped.
  const weeklyTss = week.loadUnit === 'tss' ? week.targetLoad : week.targetVolumeMeters;

  // 1) Long ride — a fraction of the week's TSS, floored + capped.
  let longTss = Math.round(
    Math.min(Math.max(weeklyTss * template.longRunFraction, Math.min(MIN_RIDE_TSS, weeklyTss)), LONG_RIDE_CAP_TSS),
  );
  let remaining = Math.max(0, weeklyTss - longTss);
  // If what's left can't make even one meaningful ride, the week IS the long ride.
  if (remaining < MIN_RIDE_TSS) {
    longTss = Math.round(weeklyTss);
    remaining = 0;
  }

  // 2) Distribute the remainder across non-long ride days by weight, consolidating
  //    away shares too small to be worth clipping in (mirrors the running loop).
  let active =
    remaining >= MIN_RIDE_TSS ? template.days.filter((d) => d.runType !== 'long' && d.runType !== 'rest') : [];
  const allocFor = (set: typeof active) => {
    const tw = set.reduce((s, d) => s + d.volumeWeight, 0) || 1;
    return new Map(set.map((d) => [d, (remaining * d.volumeWeight) / tw]));
  };
  let alloc = allocFor(active);
  while (active.length > 1) {
    const smallest = [...alloc.entries()].sort((a, b) => a[1] - b[1])[0];
    if (smallest[1] >= MIN_RIDE_TSS) break;
    active = active.filter((d) => d !== smallest[0]);
    alloc = allocFor(active);
  }

  const days: PlannedDay[] = template.days.map((dt) => {
    const day = addDays(week.weekStart, dt.dow);
    const base = { day, dow: dt.dow, pinned: false, optionalStrides: dt.optionalStrides ?? false };

    if (dt.runType === 'rest') {
      return { ...base, runType: 'rest' as const, zone: null, distanceMeters: 0, durationSeconds: 0, targetLoadTss: 0, description: 'Rest day — off the bike.' };
    }

    if (dt.runType === 'long') {
      const durationSeconds = Math.round(durationSecondsFromTss(longTss, LONG_RIDE_IF));
      return {
        ...base,
        runType: 'long' as const,
        zone: 'endurance',
        distanceMeters: 0,
        durationSeconds,
        targetLoadTss: longTss,
        segments: longRideSegments(toMinutes(durationSeconds), template.phase, zones),
        description: longRideDescription(toMinutes(durationSeconds), longTss, template.phase, zones),
      };
    }

    // Consolidated away (share below the minimum meaningful ride) → rest.
    if (!alloc.has(dt)) {
      return { ...base, runType: 'rest' as const, zone: null, distanceMeters: 0, durationSeconds: 0, targetLoadTss: 0, description: 'Rest day — off the bike.' };
    }
    const dayTss = Math.round(alloc.get(dt)!);

    // A real quality session needs room for warm-up + work + cool-down; below the
    // floor it degrades to an aerobic ride instead.
    if (dt.runType === 'quality' && dt.quality && dayTss >= MIN_QUALITY_TSS) {
      const qZone = dt.quality.zone as PowerZoneKey;
      const totalMin = toMinutes(durationSecondsFromTss(dayTss, zoneIf(qZone)));
      const wuCd = warmupCooldownMinutes(totalMin);
      const workMin = Math.max(0, totalMin - 2 * wuCd);
      // Deterministic variety: rotate the template by week + day.
      const seed = week.weeksToRace + dt.dow;
      return {
        ...base,
        runType: 'quality' as const,
        zone: qZone,
        distanceMeters: 0,
        durationSeconds: totalMin * 60,
        targetLoadTss: dayTss,
        warmup: `${wuCd} min build to ${targetLabel(zones, 'endurance')} + openers`,
        cooldown: `${wuCd} min easy spin @ ${targetLabel(zones, 'recovery')}`,
        segments: strategy.buildQualitySegments(totalMin, qZone, zones, workMin, wuCd, seed),
        description: strategy.buildQualityDescription(totalMin, qZone, zones, workMin, wuCd, seed),
      };
    }

    // Endurance / recovery fill (or a quality day too small to be quality): one
    // steady aerobic block.
    const zone = dt.runType === 'quality' ? 'endurance' : zoneForBikeType(dt.runType)!;
    const totalMin = toMinutes(durationSecondsFromTss(dayTss, zoneIf(zone)));
    return {
      ...base,
      runType: dt.runType === 'quality' ? ('easy' as const) : dt.runType,
      zone,
      distanceMeters: 0,
      durationSeconds: totalMin * 60,
      targetLoadTss: dayTss,
      description: `${cap(ZONE_LABEL[zone])} ride, ${totalMin} min @ ${targetLabel(zones, zone)} — steady aerobic effort`,
    };
  });

  return {
    weekStart: week.weekStart,
    phase: template.phase,
    cycle: week.cycle,
    targetVolumeMeters: 0,
    targetLoadTss: Math.round(weeklyTss),
    days,
    rationale: rationale || defaultRationale(template.phase, week.weeksToRace, Math.round(weeklyTss)),
  };
}

/**
 * Long-ride segments: Z2 endurance lead-in, sweet-spot blocks embedded in the
 * middle (build/peak, long enough), easy endurance finish — the power-side twin
 * of the running long run's marathon-pace segments.
 */
function longRideSegments(
  totalMin: number,
  phase: PlannedWeek['phase'],
  zones: PowerZones,
): WorkoutSegment[] | undefined {
  if (!((phase === 'build' || phase === 'peak') && totalMin >= 120)) return undefined;
  const lead = Math.round(totalMin * 0.35);
  const finish = Math.round(totalMin * 0.2);
  const ssTotal = Math.max(0, totalMin - lead - finish);
  const blocks = ssTotal >= 45 ? 3 : 2;
  const blockMin = Math.round(ssTotal / blocks);
  return [
    {
      role: 'warmup',
      zone: 'endurance',
      durationSeconds: lead * 60,
      ...wattTargets(zones, 'endurance'),
      note: `${lead} min relaxed @ ${targetLabel(zones, 'endurance')}`,
    },
    {
      role: 'work',
      zone: 'sweetspot',
      reps: blocks,
      repSeconds: blockMin * 60,
      restSeconds: 5 * 60,
      ...wattTargets(zones, 'sweetspot'),
      note: `${blocks} × ${blockMin} min @ ${targetLabel(zones, 'sweetspot')} · 5 min easy spin between — muscular endurance on tired legs`,
    },
    {
      role: 'cooldown',
      zone: 'endurance',
      durationSeconds: finish * 60,
      ...wattTargets(zones, 'endurance'),
      note: `${finish} min easy @ ${targetLabel(zones, 'endurance')} to finish`,
    },
  ];
}

function longRideDescription(
  totalMin: number,
  tss: number,
  phase: PlannedWeek['phase'],
  zones: PowerZones,
): string {
  if ((phase === 'build' || phase === 'peak') && totalMin >= 120) {
    return `Long ride ${totalMin} min (~${tss} TSS): Z2 endurance @ ${targetLabel(
      zones,
      'endurance',
    )} with sweet-spot blocks @ ${targetLabel(zones, 'sweetspot')}. Fuel early, stay smooth.`;
  }
  return `Long ride ${totalMin} min (~${tss} TSS) @ ${targetLabel(zones, 'endurance')}, relaxed aerobic Z2.`;
}

function defaultRationale(phase: PlannedWeek['phase'], weeksToRace: number, weeklyTss: number): string {
  const head = {
    base: 'Base week — build aerobic base and durability with sweet-spot work.',
    build: 'Build week — raise FTP with threshold, sharpen with VO2max as volume ramps.',
    peak: 'Peak week — highest load; threshold + VO2max on top of a big long ride.',
    taper: 'Taper — cut volume, keep a little intensity, arrive fresh and snappy.',
  }[phase];
  return `${head} ${weeksToRace} week(s) to race. Weekly load ~${weeklyTss} TSS. Consistency over heroics — hold the targets, don't chase watts.`;
}
