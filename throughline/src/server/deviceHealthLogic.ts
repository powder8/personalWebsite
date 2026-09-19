/**
 * PURE device-health payload handling (no DB). The native app reads HealthKit
 * (iOS) or Health Connect (Android) on-device and POSTs an already-normalized
 * payload here; this module validates it and maps it onto the provider-neutral
 * NormalizedBatch that the ordinary ingest pipeline persists.
 *
 * Both stores are folded into ONE wire format so the server never learns
 * platform quirks: the app does the HealthKit/Health Connect reading, we do
 * the bounds checks and the table mapping. Out-of-range values are dropped per
 * field (and reported), not rejected wholesale — a bad body-fat sample must not
 * cost a night of sleep data.
 */
import type { NormalizedBatch } from '@/providers/types';

export type DeviceSource = 'healthkit' | 'health_connect';

/** The provider each device store is recorded under in the derived tables. */
export const PROVIDER_FOR_SOURCE = { healthkit: 'apple', health_connect: 'health_connect' } as const;
export type DeviceProvider = (typeof PROVIDER_FOR_SOURCE)[DeviceSource];

export interface DeviceDay {
  /** Athlete-local calendar day, YYYY-MM-DD. Sleep is keyed by its WAKE-UP day. */
  day: string;
  steps?: number | null;
  restingHr?: number | null;
  /** Overnight HRV (Apple: SDNN in ms; Health Connect: RMSSD in ms). */
  hrvMs?: number | null;
  sleep?: {
    totalSeconds: number;
    deepSeconds?: number | null;
    remSeconds?: number | null;
    lightSeconds?: number | null;
    awakeSeconds?: number | null;
  } | null;
  weightKg?: number | null;
  bodyFatPct?: number | null;
  /** The device's VO2max estimate (ml/kg/min). Both stores derive it from outdoor walk/run, so it lands as the RUNNING estimate. */
  vo2max?: number | null;
}

export type DeviceSport = 'run' | 'bike' | 'swim' | 'strength' | 'walk' | 'other';

export interface DeviceWorkout {
  /** The store's own stable id for the workout (HKWorkout UUID / Health Connect record id). */
  sourceRef: string;
  /** ISO-8601 start instant. */
  start: string;
  sport: DeviceSport;
  durationSeconds: number;
  distanceMeters?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  elevationGainMeters?: number | null;
  name?: string | null;
}

export interface DevicePayload {
  source: DeviceSource;
  days?: DeviceDay[];
  workouts?: DeviceWorkout[];
}

/** Hard ceilings so one runaway push can't create unbounded rows. */
export const MAX_DAYS = 400;
export const MAX_WORKOUTS = 500;

/** Plausibility bounds; anything outside is a sensor glitch, not data. */
const BOUNDS = {
  steps: [0, 200_000],
  restingHr: [25, 120],
  hrvMs: [1, 400],
  sleepSeconds: [0, 24 * 3600],
  weightKg: [20, 400],
  bodyFatPct: [1, 75],
  vo2max: [10, 100],
  durationSeconds: [60, 24 * 3600],
  distanceMeters: [0, 1_000_000],
  hr: [30, 240],
  elevationGainMeters: [0, 20_000],
} as const;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SPORTS: ReadonlySet<string> = new Set(['run', 'bike', 'swim', 'strength', 'walk', 'other']);

export type ValidationResult =
  | { ok: true; payload: DevicePayload }
  | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Structural validation: shape, sizes, day format, sport vocabulary. Values are
 * NOT range-checked here (that happens per field in toBatch so a single bad
 * number drops one field, not the request).
 */
export function validateDevicePayload(raw: unknown): ValidationResult {
  if (!isObj(raw)) return { ok: false, error: 'Body must be a JSON object.' };
  const source = raw.source;
  if (source !== 'healthkit' && source !== 'health_connect') {
    return { ok: false, error: "source must be 'healthkit' or 'health_connect'." };
  }
  const days = raw.days ?? [];
  const workouts = raw.workouts ?? [];
  if (!Array.isArray(days) || !Array.isArray(workouts)) return { ok: false, error: 'days and workouts must be arrays.' };
  if (days.length > MAX_DAYS) return { ok: false, error: `Too many days (max ${MAX_DAYS}).` };
  if (workouts.length > MAX_WORKOUTS) return { ok: false, error: `Too many workouts (max ${MAX_WORKOUTS}).` };
  if (days.length === 0 && workouts.length === 0) return { ok: false, error: 'Nothing to ingest.' };

  for (const [i, d] of days.entries()) {
    if (!isObj(d) || typeof d.day !== 'string' || !DAY_RE.test(d.day) || Number.isNaN(Date.parse(`${d.day}T00:00:00Z`))) {
      return { ok: false, error: `days[${i}].day must be YYYY-MM-DD.` };
    }
    if (d.sleep != null && (!isObj(d.sleep) || typeof d.sleep.totalSeconds !== 'number')) {
      return { ok: false, error: `days[${i}].sleep.totalSeconds is required.` };
    }
  }
  for (const [i, w] of workouts.entries()) {
    if (!isObj(w)) return { ok: false, error: `workouts[${i}] must be an object.` };
    if (typeof w.sourceRef !== 'string' || !w.sourceRef.trim() || w.sourceRef.length > 200) {
      return { ok: false, error: `workouts[${i}].sourceRef is required.` };
    }
    if (typeof w.start !== 'string' || Number.isNaN(Date.parse(w.start))) {
      return { ok: false, error: `workouts[${i}].start must be an ISO-8601 instant.` };
    }
    if (typeof w.sport !== 'string' || !SPORTS.has(w.sport)) {
      return { ok: false, error: `workouts[${i}].sport must be one of ${[...SPORTS].join(', ')}.` };
    }
    if (typeof w.durationSeconds !== 'number') return { ok: false, error: `workouts[${i}].durationSeconds is required.` };
  }
  return { ok: true, payload: { source, days: days as DeviceDay[], workouts: workouts as DeviceWorkout[] } };
}

/** A finite number inside [lo, hi], else null (and a note in `skipped`). */
function inRange(v: unknown, [lo, hi]: readonly [number, number], label: string, skipped: string[]): number | null {
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
    skipped.push(label);
    return null;
  }
  return v;
}

/** Walk/other workouts carry no plan meaning but do carry load; map to the sport enum. */
function sportFor(s: DeviceSport): 'run' | 'bike' | 'swim' | 'strength' | 'cross_train' | 'other' {
  if (s === 'walk') return 'cross_train';
  return s;
}

export interface DeviceBatch {
  batch: NormalizedBatch;
  /** Field-level drops, e.g. "2026-09-18 restingHr", "workout abc distanceMeters". */
  skipped: string[];
  counts: { days: number; sleep: number; hrv: number; restingHr: number; workouts: number };
}

/**
 * Map a validated payload onto the derived tables. `today` (athlete-local
 * YYYY-MM-DD) bounds the future: a day past tomorrow is a clock bug and is
 * dropped whole.
 */
export function toNormalizedBatch(payload: DevicePayload, today: string): DeviceBatch {
  const skipped: string[] = [];
  const provider = PROVIDER_FOR_SOURCE[payload.source];
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const maxDay = tomorrow.toISOString().slice(0, 10);

  const batch: Required<NormalizedBatch> = { activities: [], dailySummaries: [], sleepRecords: [], hrvRecords: [], restingHrRecords: [] };
  const seenDay = new Set<string>();

  for (const d of payload.days ?? []) {
    if (d.day > maxDay) { skipped.push(`${d.day} (future day)`); continue; }
    if (seenDay.has(d.day)) { skipped.push(`${d.day} (duplicate day)`); continue; }
    seenDay.add(d.day);

    const steps = inRange(d.steps, BOUNDS.steps, `${d.day} steps`, skipped);
    const restingHr = inRange(d.restingHr, BOUNDS.restingHr, `${d.day} restingHr`, skipped);
    const hrvMs = inRange(d.hrvMs, BOUNDS.hrvMs, `${d.day} hrvMs`, skipped);
    const weightKg = inRange(d.weightKg, BOUNDS.weightKg, `${d.day} weightKg`, skipped);
    const bodyFatPct = inRange(d.bodyFatPct, BOUNDS.bodyFatPct, `${d.day} bodyFatPct`, skipped);
    const vo2max = inRange(d.vo2max, BOUNDS.vo2max, `${d.day} vo2max`, skipped);

    // Only write a daily row when it carries something — an empty row would
    // still claim the (athlete, day) slot with nulls.
    if (steps != null || restingHr != null || weightKg != null || bodyFatPct != null || vo2max != null) {
      batch.dailySummaries.push({
        day: d.day,
        provider,
        steps: steps == null ? null : Math.round(steps),
        restingHr: restingHr == null ? null : Math.round(restingHr),
        weightKg,
        bodyFatPct,
        vo2maxRunning: vo2max,
      });
    }
    if (restingHr != null) batch.restingHrRecords.push({ day: d.day, provider, restingHr: Math.round(restingHr) });
    if (hrvMs != null) batch.hrvRecords.push({ day: d.day, provider, overnightAvgMs: hrvMs });
    if (d.sleep) {
      const total = inRange(d.sleep.totalSeconds, BOUNDS.sleepSeconds, `${d.day} sleep`, skipped);
      if (total != null) {
        const stage = (v: unknown, k: string) => {
          const n = inRange(v, BOUNDS.sleepSeconds, `${d.day} sleep.${k}`, skipped);
          return n == null ? null : Math.round(n);
        };
        batch.sleepRecords.push({
          day: d.day,
          provider,
          totalSleepSeconds: Math.round(total),
          deepSeconds: stage(d.sleep.deepSeconds, 'deepSeconds'),
          remSeconds: stage(d.sleep.remSeconds, 'remSeconds'),
          lightSeconds: stage(d.sleep.lightSeconds, 'lightSeconds'),
          awakeSeconds: stage(d.sleep.awakeSeconds, 'awakeSeconds'),
        });
      }
    }
  }

  const seenRef = new Set<string>();
  for (const w of payload.workouts ?? []) {
    const ref = `${payload.source}:${w.sourceRef.trim()}`;
    if (seenRef.has(ref)) { skipped.push(`workout ${w.sourceRef} (duplicate)`); continue; }
    seenRef.add(ref);
    const duration = inRange(w.durationSeconds, BOUNDS.durationSeconds, `workout ${w.sourceRef} durationSeconds`, skipped);
    if (duration == null) continue; // a workout is nothing without a duration
    const startTime = new Date(w.start);
    if (startTime.getTime() > Date.parse(`${maxDay}T23:59:59Z`)) { skipped.push(`workout ${w.sourceRef} (future)`); continue; }
    const distance = inRange(w.distanceMeters, BOUNDS.distanceMeters, `workout ${w.sourceRef} distanceMeters`, skipped);
    const avgHr = inRange(w.avgHr, BOUNDS.hr, `workout ${w.sourceRef} avgHr`, skipped);
    const maxHr = inRange(w.maxHr, BOUNDS.hr, `workout ${w.sourceRef} maxHr`, skipped);
    const elev = inRange(w.elevationGainMeters, BOUNDS.elevationGainMeters, `workout ${w.sourceRef} elevationGainMeters`, skipped);
    batch.activities.push({
      sourceRef: ref,
      provider,
      sport: sportFor(w.sport),
      name: typeof w.name === 'string' && w.name.trim() ? w.name.trim().slice(0, 120) : null,
      startTime,
      durationSeconds: Math.round(duration),
      elapsedSeconds: Math.round(duration),
      distanceMeters: distance,
      avgHr: avgHr == null ? null : Math.round(avgHr),
      maxHr: maxHr == null ? null : Math.round(maxHr),
      avgPaceSecPerKm: distance && distance > 0 ? duration / (distance / 1000) : null,
      elevationGainMeters: elev,
      trainingLoad: null, // derived later by the load model
    });
  }

  return {
    batch,
    skipped,
    counts: {
      days: batch.dailySummaries.length,
      sleep: batch.sleepRecords.length,
      hrv: batch.hrvRecords.length,
      restingHr: batch.restingHrRecords.length,
      workouts: batch.activities.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Cross-source workout dedup
// ---------------------------------------------------------------------------

export interface WorkoutKey {
  /** Optional because insert rows may omit it (the column defaults to 'run'). */
  sport?: string | null;
  startTime: Date;
  durationSeconds?: number | null;
}

/** Two recordings of the same session start within this many seconds of each other… */
export const DUP_START_WINDOW_SEC = 5 * 60;
/** …and have durations within this fraction (or 2 min, whichever is larger). */
export const DUP_DURATION_TOLERANCE = 0.15;

/**
 * Whether a device workout is the SAME session as an activity we already hold
 * from another source (an Apple Watch run that also reached us via Strava).
 * Same sport, starts within the window, durations roughly equal. Strava is the
 * richer record (splits, route), so the device copy is the one that yields.
 */
export function isSameWorkout(a: WorkoutKey, b: WorkoutKey): boolean {
  if ((a.sport ?? 'run') !== (b.sport ?? 'run')) return false;
  if (Math.abs(a.startTime.getTime() - b.startTime.getTime()) > DUP_START_WINDOW_SEC * 1000) return false;
  if (a.durationSeconds == null || b.durationSeconds == null) return true;
  const tol = Math.max(120, Math.max(a.durationSeconds, b.durationSeconds) * DUP_DURATION_TOLERANCE);
  return Math.abs(a.durationSeconds - b.durationSeconds) <= tol;
}
