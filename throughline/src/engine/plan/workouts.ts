/**
 * Workout template library — specific, varied, coach-authored quality sessions.
 *
 * Motivation (coach + Peter): "threshold" as a bare label means nothing. A real
 * session says how long the warm-up is and how fast, how long each rep is and at
 * what pace, and whether the recovery is a jog, a standing rest, or a float.
 * These templates are modeled on Heather's real training-log sessions (structure,
 * variety, recovery style) but the PACES are always the athlete's own (from their
 * zones), never a verbatim elite pace.
 *
 * Each quality zone has several templates; the generator rotates through them
 * (deterministically, by a seed) so an athlete isn't handed the identical
 * threshold session every week. Adding a new session = adding an entry here.
 */
import type { WorkoutSegment, ZoneKey, PaceZones } from './types';
import { paceRangeLabel, milesToMeters } from './zones';

function roundMiles(mi: number): number {
  return Math.round(mi * 10) / 10;
}
function clampInt(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(x)));
}
function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * A quality-session template. `work` returns the main-set segment(s), scaled to
 * roughly fill `workMiles` at the athlete's paces; `prose` is the one-line mirror.
 */
export interface QualityTemplate {
  id: string;
  label: string;
  zone: ZoneKey;
  work(workMiles: number, zones: PaceZones): WorkoutSegment[];
  prose(workMiles: number, zones: PaceZones): string;
}

// --- Template library, per quality zone ---------------------------------------

const THRESHOLD_TEMPLATES: QualityTemplate[] = [
  {
    id: 'thr-cruise-mile',
    label: 'Cruise intervals',
    zone: 'threshold',
    work(wm, z) {
      const reps = clampInt(wm, 3, 8);
      const p = paceRangeLabel(z.zones.threshold);
      return [{ role: 'work', zone: 'threshold', reps, repMeters: milesToMeters(1), restSeconds: 60,
        note: `${reps} × 1 mi @ ${p} · 60s standing/easy-jog rest — comfortably hard, controlled` }];
    },
    prose(wm, z) {
      const reps = clampInt(wm, 3, 8);
      return `${reps} × 1 mi @ ${paceRangeLabel(z.zones.threshold)} with 60s rest`;
    },
  },
  {
    id: 'thr-sustained',
    label: 'Sustained tempo',
    zone: 'threshold',
    work(wm, z) {
      const m = roundMiles(wm);
      return [{ role: 'work', zone: 'threshold', distanceMeters: milesToMeters(m),
        note: `${m} mi continuous @ ${paceRangeLabel(z.zones.threshold)} — one sustained effort, no breaks` }];
    },
    prose(wm, z) {
      return `${roundMiles(wm)} mi continuous @ ${paceRangeLabel(z.zones.threshold)}`;
    },
  },
  {
    id: 'thr-cruise-1k',
    label: '1K cruise reps',
    zone: 'threshold',
    work(wm, z) {
      const reps = clampInt(wm / 0.62, 4, 10);
      const p = paceRangeLabel(z.zones.threshold);
      return [{ role: 'work', zone: 'threshold', reps, repMeters: 1000, restSeconds: 45,
        note: `${reps} × 1000m @ ${p} · 45s easy-jog rest — smooth and repeatable` }];
    },
    prose(wm, z) {
      return `${clampInt(wm / 0.62, 4, 10)} × 1000m @ ${paceRangeLabel(z.zones.threshold)} with 45s jog`;
    },
  },
  {
    id: 'thr-broken',
    label: 'Broken tempo',
    zone: 'threshold',
    work(wm, z) {
      const half = roundMiles(wm / 2);
      const p = paceRangeLabel(z.zones.threshold);
      return [{ role: 'work', zone: 'threshold', reps: 2, repMeters: milesToMeters(half), restSeconds: 120,
        note: `2 × ${half} mi @ ${p} · 2 min easy jog between — hold form through the second rep` }];
    },
    prose(wm, z) {
      return `2 × ${roundMiles(wm / 2)} mi @ ${paceRangeLabel(z.zones.threshold)} with 2 min jog`;
    },
  },
];

const INTERVAL_TEMPLATES: QualityTemplate[] = [
  {
    id: 'int-vo2-mile',
    label: 'VO2 miles',
    zone: 'interval',
    work(wm, z) {
      const reps = clampInt(wm, 3, 6);
      const p = paceRangeLabel(z.zones.interval);
      return [{ role: 'work', zone: 'interval', reps, repMeters: milesToMeters(1), restSeconds: 180,
        note: `${reps} × 1 mi @ ${p} · 3 min easy jog between — even efforts, don't sprint the first` }];
    },
    prose(wm, z) {
      return `${clampInt(wm, 3, 6)} × 1 mi @ ${paceRangeLabel(z.zones.interval)} with 3 min jog`;
    },
  },
  {
    id: 'int-vo2-1000',
    label: 'VO2 1000s',
    zone: 'interval',
    work(wm, z) {
      const reps = clampInt(wm / 0.62, 4, 8);
      const p = paceRangeLabel(z.zones.interval);
      return [{ role: 'work', zone: 'interval', reps, repMeters: 1000, restSeconds: 150,
        note: `${reps} × 1000m @ ${p} · 2:30 jog between — strong and smooth` }];
    },
    prose(wm, z) {
      return `${clampInt(wm / 0.62, 4, 8)} × 1000m @ ${paceRangeLabel(z.zones.interval)} with 2:30 jog`;
    },
  },
  {
    id: 'int-vo2-800',
    label: 'VO2 800s',
    zone: 'interval',
    work(wm, z) {
      const reps = clampInt(wm / 0.5, 5, 10);
      const p = paceRangeLabel(z.zones.interval);
      return [{ role: 'work', zone: 'interval', reps, repMeters: 800, restSeconds: 120,
        note: `${reps} × 800m @ ${p} · 2 min jog between — pick it up in the last two` }];
    },
    prose(wm, z) {
      return `${clampInt(wm / 0.5, 5, 10)} × 800m @ ${paceRangeLabel(z.zones.interval)} with 2 min jog`;
    },
  },
];

const REP_TEMPLATES: QualityTemplate[] = [
  {
    id: 'rep-400',
    label: 'Speed 400s',
    zone: 'rep',
    work(wm, z) {
      const reps = clampInt(wm / 0.25, 6, 12);
      const p = paceRangeLabel(z.zones.rep);
      return [{ role: 'work', zone: 'rep', reps, repMeters: 400, restSeconds: 120,
        note: `${reps} × 400m @ ${p} · full recovery (walk/jog ~2 min until fresh) — quick, relaxed turnover` }];
    },
    prose(wm, z) {
      return `${clampInt(wm / 0.25, 6, 12)} × 400m @ ${paceRangeLabel(z.zones.rep)}, full recovery`;
    },
  },
  {
    id: 'rep-300-sets',
    label: 'Speed 300s in sets',
    zone: 'rep',
    work(wm, z) {
      const perSet = 3;
      const sets = clampInt(wm / (perSet * 0.19), 2, 4);
      const p = paceRangeLabel(z.zones.rep);
      return [{ role: 'work', zone: 'rep', reps: sets * perSet, repMeters: 300, restSeconds: 180,
        note: `${sets} × (${perSet} × 300m @ ${p}, 100m jog) · 3 min between sets — sharp and smooth` }];
    },
    prose(wm, z) {
      const sets = clampInt(wm / 0.57, 2, 4);
      return `${sets} × (3 × 300m @ ${paceRangeLabel(z.zones.rep)}, 100m jog)`;
    },
  },
  {
    id: 'rep-200',
    label: 'Speed 200s',
    zone: 'rep',
    work(wm, z) {
      const reps = clampInt(wm / 0.125, 8, 16);
      const p = paceRangeLabel(z.zones.rep);
      return [{ role: 'work', zone: 'rep', reps, repMeters: 200, restSeconds: 90,
        note: `${reps} × 200m @ ${p} · 200m easy jog between — fast but loose, never straining` }];
    },
    prose(wm, z) {
      return `${clampInt(wm / 0.125, 8, 16)} × 200m @ ${paceRangeLabel(z.zones.rep)} with 200m jog`;
    },
  },
];

const TEMPLATES: Partial<Record<ZoneKey, QualityTemplate[]>> = {
  threshold: THRESHOLD_TEMPLATES,
  interval: INTERVAL_TEMPLATES,
  rep: REP_TEMPLATES,
};

/** Pick a template for a zone by a deterministic seed (variety week-to-week). */
function pickTemplate(zone: ZoneKey, seed: number): QualityTemplate | null {
  const list = TEMPLATES[zone];
  if (!list || list.length === 0) return null;
  const i = ((seed % list.length) + list.length) % list.length;
  return list[i];
}

function warmupSegment(wuCd: number, zones: PaceZones): WorkoutSegment {
  return {
    role: 'warmup',
    zone: 'easy',
    distanceMeters: milesToMeters(wuCd),
    note: `${wuCd} mi easy @ ${paceRangeLabel(zones.zones.easy)}, then 3–4 mobility drills + 4 × 20s strides to open up`,
  };
}
function cooldownSegment(wuCd: number, zones: PaceZones): WorkoutSegment {
  return {
    role: 'cooldown',
    zone: 'easy',
    distanceMeters: milesToMeters(wuCd),
    note: `${wuCd} mi very easy @ ${paceRangeLabel(zones.zones.easy)} — let the heart rate come down`,
  };
}

function continuousWork(zone: ZoneKey, workMiles: number, zones: PaceZones): WorkoutSegment {
  return {
    role: 'work',
    zone,
    distanceMeters: milesToMeters(workMiles),
    note: `${roundMiles(workMiles)} mi continuous @ ${paceRangeLabel(zones.zones[zone])}`,
  };
}

/**
 * Build the full structured session (warm-up → main set → cool-down) for a
 * quality day. `seed` selects the template variant so weeks vary. Zones without
 * a template (e.g. marathon-pace) fall back to a continuous effort.
 */
export function buildQualitySegments(
  dayMiles: number,
  zone: ZoneKey,
  zones: PaceZones,
  workMiles: number,
  wuCd: number,
  seed: number,
): WorkoutSegment[] {
  const template = pickTemplate(zone, seed);
  const work = template ? template.work(workMiles, zones) : [continuousWork(zone, workMiles, zones)];
  return [warmupSegment(wuCd, zones), ...work, cooldownSegment(wuCd, zones)];
}

/** Prose mirror of the chosen session, in the coach's format. */
export function buildQualityDescription(
  dayMiles: number,
  zone: ZoneKey,
  zones: PaceZones,
  workMiles: number,
  wuCd: number,
  seed: number,
): string {
  const template = pickTemplate(zone, seed);
  const main = template
    ? `${template.label} — ${template.prose(workMiles, zones)}`
    : `${roundMiles(workMiles)} mi @ ${paceRangeLabel(zones.zones[zone])}`;
  return `${cap(main)}; ${wuCd} mi warm-up + drills/strides and ${wuCd} mi cool-down (${dayMiles} mi total)`;
}
