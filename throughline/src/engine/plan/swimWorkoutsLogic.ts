/**
 * Swim workout library — the swim-side twin of `workouts.ts` / `bikeWorkoutsLogic.ts`.
 *
 * Swim sessions are DISTANCE × CSS-relative pace (metres at a sec/100 m target)
 * structured as warm-up → main set → cool-down, exactly as running sessions are
 * distance × pace and cycling sessions are duration × %FTP. It reuses the same
 * shape as the other libraries:
 *   - a `SwimQualityTemplate` per quality zone (id, label, zone, `work()`
 *     builder, `prose()` mirror), modelled on Swim Smooth / Friel CSS sets;
 *   - deterministic seed rotation (`pickTemplate(zone, seed)`) so an athlete
 *     isn't handed the identical set every week;
 *   - a continuous fallback for zones without a template (aerobic/recovery).
 *
 * Swim's distinctive feature: TECHNIQUE / drill work is a FIRST-CLASS session
 * type, not an afterthought (swim-foundation-spec.md §5 / tri-spec §3.4 — swim's
 * time-yield per hour is high when technique is the limiter). `buildSwimTechniqueSegments`
 * emits a drill session prescribed by frequency, and `SWIM_DRILLS` is the rotated
 * drill catalogue.
 *
 * Pace targets are always the athlete's OWN, taken from their resolved
 * `SwimZones` (sec/100 m), never verbatim times. Volumes are in METRES (the swim
 * seam speaks metres, versus miles on the run and minutes on the bike).
 *
 * Pure and DB-free (no `server-only` import), like `workouts.ts`.
 */
import type { SwimZoneKey, SwimZones, SwimRange, WorkoutSegment } from './types';
import { swimPaceLabel } from './swimZonesLogic';

// --- small helpers (mirrors of the other libraries') --------------------------

function clampInt(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(x)));
}
function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** The sec/100 m pace label for a zone, e.g. "1:35–1:38 /100m". */
function targetLabel(zones: SwimZones, key: SwimZoneKey): string {
  return swimPaceLabel(zones.zones[key]);
}
/** A short CSS-relative descriptor for prose, e.g. "@ CSS", "@ CSS+4–10". */
const CSS_DESCRIPTOR: Record<SwimZoneKey, string> = {
  recovery: 'easy (CSS+10-20)',
  aerobic: 'CSS+4-10',
  threshold: 'CSS',
  vo2max: 'CSS−2-6 (fast)',
  sprint: 'sprint (CSS−6+)',
};
/** Pace bounds for a segment, taken from the athlete's own CSS-relative zone. */
function paceTargets(zones: SwimZones, key: SwimZoneKey): Pick<WorkoutSegment, 'targetFastSecPer100' | 'targetSlowSecPer100'> {
  const r: SwimRange = zones.zones[key];
  return { targetFastSecPer100: r.fastSecPer100, targetSlowSecPer100: r.slowSecPer100 };
}

// --- template model -----------------------------------------------------------

/**
 * A swim quality-session template. `work` returns the main-set segment(s), scaled
 * to roughly fill `workMeters` at the athlete's CSS-relative pace; `prose` is the
 * one-line mirror. The swim-side twin of `BikeQualityTemplate` / `QualityTemplate`.
 */
export interface SwimQualityTemplate {
  id: string;
  label: string;
  zone: SwimZoneKey;
  work(workMeters: number, zones: SwimZones): WorkoutSegment[];
  prose(workMeters: number, zones: SwimZones): string;
}

/** One interval set `work` segment: `reps × repMeters @ target`, with rest. */
function intervalSet(
  zone: SwimZoneKey,
  reps: number,
  repMeters: number,
  restSeconds: number,
  zones: SwimZones,
  note: string,
): WorkoutSegment {
  return { role: 'work', zone, reps, repMeters, restSeconds, ...paceTargets(zones, zone), note };
}

// --- the library, per quality zone --------------------------------------------

const THRESHOLD_TEMPLATES: SwimQualityTemplate[] = [
  {
    id: 'thr-100s',
    label: 'CSS 100s',
    zone: 'threshold',
    work(wm, z) {
      const reps = clampInt(wm / 100, 6, 16);
      return [
        intervalSet('threshold', reps, 100, 15, z,
          `${reps} × 100 m @ ${targetLabel(z, 'threshold')} (CSS) · 15 s rest, hold CSS to the last rep`),
      ];
    },
    prose: (wm, z) => `${clampInt(wm / 100, 6, 16)} × 100 m @ ${targetLabel(z, 'threshold')} (CSS) w/ 15 s`,
  },
  {
    id: 'thr-200s',
    label: 'CSS 200s',
    zone: 'threshold',
    work(wm, z) {
      const reps = clampInt(wm / 200, 3, 8);
      return [
        intervalSet('threshold', reps, 200, 20, z,
          `${reps} × 200 m @ ${targetLabel(z, 'threshold')} (around CSS) · 20 s rest, steady, controlled threshold`),
      ];
    },
    prose: (wm, z) => `${clampInt(wm / 200, 3, 8)} × 200 m @ ${targetLabel(z, 'threshold')} w/ 20 s`,
  },
  {
    id: 'thr-broken-400',
    label: 'Broken 400s',
    zone: 'threshold',
    work(wm, z) {
      const reps = clampInt(wm / 100, 8, 16);
      const sets = Math.max(1, Math.round(reps / 4));
      return [
        intervalSet('threshold', reps, 100, 10, z,
          `${sets} × broken 400 (4 × 100 m @ ${targetLabel(z, 'threshold')}, 10 s rest), race-pace feel with micro-rests`),
      ];
    },
    prose: (wm, z) =>
      `${Math.max(1, Math.round(clampInt(wm / 100, 8, 16) / 4))} × broken 400 (4×100 @ ${targetLabel(z, 'threshold')}, 10 s)`,
  },
];

const VO2MAX_TEMPLATES: SwimQualityTemplate[] = [
  {
    id: 'vo2-50s',
    label: 'VO2 50s',
    zone: 'vo2max',
    work(wm, z) {
      const reps = clampInt(wm / 50, 10, 24);
      return [
        intervalSet('vo2max', reps, 50, 15, z,
          `${reps} × 50 m @ ${targetLabel(z, 'vo2max')} · 15 s rest, above CSS, short-course sharpening`),
      ];
    },
    prose: (wm, z) => `${clampInt(wm / 50, 10, 24)} × 50 m @ ${targetLabel(z, 'vo2max')} w/ 15 s`,
  },
  {
    id: 'vo2-100s',
    label: 'VO2 100s',
    zone: 'vo2max',
    work(wm, z) {
      const reps = clampInt(wm / 100, 6, 12);
      return [
        intervalSet('vo2max', reps, 100, 30, z,
          `${reps} × 100 m @ ${targetLabel(z, 'vo2max')} · 30 s rest, even, repeatable efforts above CSS`),
      ];
    },
    prose: (wm, z) => `${clampInt(wm / 100, 6, 12)} × 100 m @ ${targetLabel(z, 'vo2max')} w/ 30 s`,
  },
];

const SPRINT_TEMPLATES: SwimQualityTemplate[] = [
  {
    id: 'spr-25s',
    label: 'Sprint 25s',
    zone: 'sprint',
    work(wm, z) {
      const reps = clampInt(wm / 25, 8, 16);
      return [
        intervalSet('sprint', reps, 25, 45, z,
          `${reps} × 25 m max @ ${targetLabel(z, 'sprint')} · full recovery (~45 s), neuromuscular, quality over quantity`),
      ];
    },
    prose: (wm, _z) => `${clampInt(wm / 25, 8, 16)} × 25 m max, full recovery`,
  },
  {
    id: 'spr-50s',
    label: 'Sprint 50s',
    zone: 'sprint',
    work(wm, z) {
      const reps = clampInt(wm / 50, 6, 12);
      return [
        intervalSet('sprint', reps, 50, 45, z,
          `${reps} × 50 m @ ${targetLabel(z, 'sprint')} · ~45 s rest, fast, controlled speed`),
      ];
    },
    prose: (wm, z) => `${clampInt(wm / 50, 6, 12)} × 50 m @ ${targetLabel(z, 'sprint')} w/ 45 s`,
  },
];

const AEROBIC_TEMPLATES: SwimQualityTemplate[] = [
  {
    id: 'aer-800s',
    label: 'Aerobic 800s',
    zone: 'aerobic',
    work(wm, z) {
      const reps = clampInt(wm / 800, 2, 5);
      return [
        intervalSet('aerobic', reps, 800, 20, z,
          `${reps} × 800 m @ ${targetLabel(z, 'aerobic')} · 20 s rest, long aerobic pulls, distance base`),
      ];
    },
    prose: (wm, z) => `${clampInt(wm / 800, 2, 5)} × 800 m @ ${targetLabel(z, 'aerobic')} w/ 20 s`,
  },
  {
    id: 'aer-400s',
    label: 'Aerobic 400s',
    zone: 'aerobic',
    work(wm, z) {
      const reps = clampInt(wm / 400, 3, 8);
      return [
        intervalSet('aerobic', reps, 400, 20, z,
          `${reps} × 400 m @ ${targetLabel(z, 'aerobic')} · 20 s rest, smooth, steady endurance`),
      ];
    },
    prose: (wm, z) => `${clampInt(wm / 400, 3, 8)} × 400 m @ ${targetLabel(z, 'aerobic')} w/ 20 s`,
  },
];

const TEMPLATES: Partial<Record<SwimZoneKey, SwimQualityTemplate[]>> = {
  threshold: THRESHOLD_TEMPLATES,
  vo2max: VO2MAX_TEMPLATES,
  sprint: SPRINT_TEMPLATES,
  aerobic: AEROBIC_TEMPLATES,
};

/** Pick a template for a zone by a deterministic seed (variety week-to-week). */
function pickTemplate(zone: SwimZoneKey, seed: number): SwimQualityTemplate | null {
  const list = TEMPLATES[zone];
  if (!list || list.length === 0) return null;
  const i = ((seed % list.length) + list.length) % list.length;
  return list[i];
}

// --- technique / drills (a first-class swim category) -------------------------

/** A named technique drill (prescribed by frequency, not load — Friel §3.4). */
export interface SwimDrill {
  id: string;
  label: string;
  cue: string;
}

/** The rotated drill catalogue (swim-foundation-spec.md §5, technique category). */
export const SWIM_DRILLS: SwimDrill[] = [
  { id: 'catch-up', label: 'Catch-up', cue: 'one arm waits for the other, long, patient front quadrant' },
  { id: 'single-arm', label: 'Single-arm', cue: 'other arm at side, feel the catch and roll on each stroke' },
  { id: 'sculling', label: 'Sculling', cue: 'small figure-8 hands, find pressure on the water, feel the catch' },
  { id: '6-kick-switch', label: '6-kick switch', cue: '6 kicks on your side, then switch, body-position + rotation' },
  { id: 'fingertip-drag', label: 'Fingertip drag', cue: 'drag fingertips on recovery, high elbow, relaxed arm' },
  { id: 'dps-golf', label: 'DPS "golf"', cue: 'count strokes + time per 50; lower the sum, distance-per-stroke' },
  { id: 'band-only', label: 'Band-only', cue: 'ankles banded, no pull-buoy, forces a strong catch and core' },
];

/** Pick a drill deterministically by seed. */
function pickDrill(seed: number): SwimDrill {
  const i = ((seed % SWIM_DRILLS.length) + SWIM_DRILLS.length) % SWIM_DRILLS.length;
  return SWIM_DRILLS[i];
}

// --- warm-up / cool-down / continuous fallback --------------------------------

function warmupSegment(wuCdMeters: number, zones: SwimZones): WorkoutSegment {
  return {
    role: 'warmup',
    zone: 'recovery',
    distanceMeters: Math.round(wuCdMeters),
    ...paceTargets(zones, 'recovery'),
    note: `${Math.round(wuCdMeters)} m easy mixed swim + drill build @ ${targetLabel(zones, 'recovery')}, a few 25 m build to race pace to open up`,
  };
}
function cooldownSegment(wuCdMeters: number, zones: SwimZones): WorkoutSegment {
  return {
    role: 'cooldown',
    zone: 'recovery',
    distanceMeters: Math.round(wuCdMeters),
    ...paceTargets(zones, 'recovery'),
    note: `${Math.round(wuCdMeters)} m easy @ ${targetLabel(zones, 'recovery')}, loosen out, easy backstroke ok`,
  };
}

/** Continuous block — the fallback for zones without a template (aerobic/recovery). */
function continuousWork(zone: SwimZoneKey, workMeters: number, zones: SwimZones): WorkoutSegment {
  const m = Math.round(workMeters);
  return {
    role: 'work',
    zone,
    distanceMeters: m,
    ...paceTargets(zones, zone),
    note: `${m} m continuous @ ${targetLabel(zones, zone)}, one steady aerobic swim`,
  };
}

// --- public API (mirrors bikeWorkoutsLogic exactly) ---------------------------

/**
 * Build the full structured swim session (warm-up → main set → cool-down) for a
 * quality day. `workMeters` is the target main-set distance; `wuCdMeters` is the
 * warm-up (and cool-down) distance. `seed` selects the template variant so weeks
 * vary. Zones without a template (recovery) fall back to a continuous block. The
 * twin of `buildBikeQualitySegments`.
 */
export function buildSwimQualitySegments(
  dayMeters: number,
  zone: SwimZoneKey,
  zones: SwimZones,
  workMeters: number,
  wuCdMeters: number,
  seed: number,
): WorkoutSegment[] {
  void dayMeters; // total is warm-up + work + cool-down; kept for seam parity.
  const template = pickTemplate(zone, seed);
  const work = template ? template.work(workMeters, zones) : [continuousWork(zone, workMeters, zones)];
  return [warmupSegment(wuCdMeters, zones), ...work, cooldownSegment(wuCdMeters, zones)];
}

/** Prose mirror of the chosen swim session. Twin of `buildBikeQualityDescription`. */
export function buildSwimQualityDescription(
  dayMeters: number,
  zone: SwimZoneKey,
  zones: SwimZones,
  workMeters: number,
  wuCdMeters: number,
  seed: number,
): string {
  const template = pickTemplate(zone, seed);
  const main = template
    ? `${template.label}, ${template.prose(workMeters, zones)}`
    : `${Math.round(workMeters)} m @ ${targetLabel(zones, zone)} (${CSS_DESCRIPTOR[zone]})`;
  return `${cap(main)}; ${Math.round(wuCdMeters)} m warm-up + openers and ${Math.round(wuCdMeters)} m cool-down (${Math.round(dayMeters)} m total)`;
}

/**
 * Build a first-class TECHNIQUE session: warm-up → rotated drill sets → easy
 * swim, prescribed by frequency rather than load (Friel). `totalMeters` is the
 * whole session; roughly half is drill work. `seed` rotates which drills appear.
 * This is the swim differentiator with no run/bike analog — surfaced so the
 * generate step and tri allocator can schedule technique as its own session.
 */
export function buildSwimTechniqueSegments(
  totalMeters: number,
  zones: SwimZones,
  seed: number,
): WorkoutSegment[] {
  const wu = clampInt(totalMeters * 0.2, 100, 600);
  const cd = clampInt(totalMeters * 0.15, 100, 400);
  const drillTotal = Math.max(100, Math.round(totalMeters - wu - cd));
  const drillA = pickDrill(seed);
  const drillB = pickDrill(seed + 3); // a different drill for variety within the set
  const perDrill = Math.max(1, Math.round(drillTotal / 2 / 50));
  const mk = (d: SwimDrill): WorkoutSegment => ({
    role: 'work',
    zone: 'recovery',
    reps: perDrill,
    repMeters: 50,
    restSeconds: 15,
    ...paceTargets(zones, 'recovery'),
    note: `${perDrill} × 50 m ${d.label} drill @ ${targetLabel(zones, 'recovery')} · 15 s, ${d.cue}`,
  });
  return [warmupSegment(wu, zones), mk(drillA), mk(drillB), cooldownSegment(cd, zones)];
}
