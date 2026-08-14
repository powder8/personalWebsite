/**
 * Cycling workout library — the power-side twin of `workouts.ts`.
 *
 * Sessions are DURATION × %FTP (minutes at a watt target) structured as
 * warm-up → main set → cool-down, exactly as running sessions are DISTANCE ×
 * pace. It reuses the same shape as the running library:
 *   - a `BikeQualityTemplate` per quality zone (id, label, zone, `work()`
 *     builder, `prose()` mirror), modelled on real Coggan/TrainerRoad-style
 *     sessions from docs/multisport/cycling-engine-spec.md §3;
 *   - deterministic seed rotation (`pickTemplate(zone, seed)`) so an athlete
 *     isn't handed the identical VO2 session every week;
 *   - a continuous fallback for zones without a template (endurance/recovery),
 *     the twin of the running `continuousWork` fallback.
 *
 * The watt targets are always the athlete's OWN, taken from their resolved
 * `PowerZones` (§2), never verbatim numbers. Riders with no power meter get the
 * SAME sessions prescribed off their %LTHR heart-rate bands instead (the
 * `basis: 'lthr'` path): the structure is identical, only the target label
 * changes from watts to bpm, and above threshold — where HR saturates — the
 * note flips to an RPE cue.
 *
 * Pure and DB-free (no `server-only` import), like `workouts.ts`.
 */
import type { PowerZoneKey, PowerZones, PowerRange, WorkoutSegment } from './types';
import { wattsLabel, bpmLabel } from './powerZonesLogic';

// --- small helpers (mirrors of the running library's) -------------------------

function clampInt(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(x)));
}
function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * The target label for a zone: watt band when the athlete has power, else the
 * %LTHR heart-rate band (no-power fallback). Above threshold on the HR path the
 * band is unreliable (HR lags/saturates), so it reads as an RPE cue instead.
 */
function targetLabel(zones: PowerZones, key: PowerZoneKey): string {
  if (zones.zones) return wattsLabel(zones.zones[key]);
  const hr = zones.hrZones?.[key];
  if (!hr) return key;
  return HR_UNRELIABLE.has(key) ? `${bpmLabel(hr)} (HR unreliable — ride by RPE)` : bpmLabel(hr);
}
/** Watt bounds for a segment, present only when the athlete has a power meter. */
function wattTargets(zones: PowerZones, key: PowerZoneKey): Pick<WorkoutSegment, 'targetLoWatts' | 'targetHiWatts'> {
  const r: PowerRange | undefined = zones.zones?.[key];
  return r ? { targetLoWatts: r.loWatts, targetHiWatts: r.hiWatts } : {};
}
/** Above-threshold zones where the %LTHR fallback is only a placeholder. */
const HR_UNRELIABLE = new Set<PowerZoneKey>(['vo2max', 'anaerobic', 'sprint']);

// --- template model -----------------------------------------------------------

/**
 * A cycling quality-session template. `work` returns the main-set segment(s),
 * scaled to roughly fill `workMinutes` at the athlete's power/HR; `prose` is the
 * one-line mirror. The power-side twin of `QualityTemplate`.
 */
export interface BikeQualityTemplate {
  id: string;
  label: string;
  zone: PowerZoneKey;
  work(workMinutes: number, zones: PowerZones): WorkoutSegment[];
  prose(workMinutes: number, zones: PowerZones): string;
}

/** One interval-set `work` segment: `reps × repSec @ target`, with recovery. */
function intervalWork(
  zone: PowerZoneKey,
  reps: number,
  repSeconds: number,
  restSeconds: number,
  zones: PowerZones,
  note: string,
): WorkoutSegment {
  return { role: 'work', zone, reps, repSeconds, restSeconds, ...wattTargets(zones, zone), note };
}

// --- the library, per quality zone --------------------------------------------

const TEMPO_TEMPLATES: BikeQualityTemplate[] = [
  {
    id: 'tempo-3x15',
    label: 'Tempo blocks',
    zone: 'tempo',
    work(wm, z) {
      const reps = clampInt(wm / 15, 2, 4);
      const t = targetLabel(z, 'tempo');
      return [
        intervalWork('tempo', reps, 15 * 60, 5 * 60, z,
          `${reps} × 15 min @ ${t} · 5 min easy spin between — steady, "brisk" muscular endurance`),
      ];
    },
    prose: (wm, z) => `${clampInt(wm / 15, 2, 4)} × 15 min @ ${targetLabel(z, 'tempo')} with 5 min easy`,
  },
  {
    id: 'tempo-2x20',
    label: 'Sustained tempo',
    zone: 'tempo',
    work(wm, z) {
      const each = clampInt(wm / 2, 15, 30);
      const t = targetLabel(z, 'tempo');
      return [
        intervalWork('tempo', 2, each * 60, 5 * 60, z,
          `2 × ${each} min @ ${t} · 5 min easy between — hold a smooth, controlled effort`),
      ];
    },
    prose: (wm, z) => `2 × ${clampInt(wm / 2, 15, 30)} min @ ${targetLabel(z, 'tempo')} with 5 min easy`,
  },
];

const SWEETSPOT_TEMPLATES: BikeQualityTemplate[] = [
  {
    id: 'ss-3x12',
    label: 'Sweet-spot 12s',
    zone: 'sweetspot',
    work(wm, z) {
      const reps = clampInt(wm / 12, 2, 4);
      const t = targetLabel(z, 'sweetspot');
      return [
        intervalWork('sweetspot', reps, 12 * 60, 4 * 60, z,
          `${reps} × 12 min @ ${t} · 4 min easy spin between — max aerobic return per unit fatigue`),
      ];
    },
    prose: (wm, z) => `${clampInt(wm / 12, 2, 4)} × 12 min @ ${targetLabel(z, 'sweetspot')} with 4 min easy`,
  },
  {
    id: 'ss-3x15',
    label: 'Sweet-spot 15s',
    zone: 'sweetspot',
    work(wm, z) {
      const reps = clampInt(wm / 15, 2, 4);
      const t = targetLabel(z, 'sweetspot');
      return [
        intervalWork('sweetspot', reps, 15 * 60, 5 * 60, z,
          `${reps} × 15 min @ ${t} · 5 min easy between — settle in, aerobically strong`),
      ];
    },
    prose: (wm, z) => `${clampInt(wm / 15, 2, 4)} × 15 min @ ${targetLabel(z, 'sweetspot')} with 5 min easy`,
  },
];

const THRESHOLD_TEMPLATES: BikeQualityTemplate[] = [
  {
    id: 'thr-4x8',
    label: 'Threshold 8s',
    zone: 'threshold',
    work(wm, z) {
      const reps = clampInt(wm / 8, 3, 5);
      const t = targetLabel(z, 'threshold');
      return [
        intervalWork('threshold', reps, 8 * 60, 4 * 60, z,
          `${reps} × 8 min @ ${t} · 4 min easy spin between — comfortably hard, controlled TT effort`),
      ];
    },
    prose: (wm, z) => `${clampInt(wm / 8, 3, 5)} × 8 min @ ${targetLabel(z, 'threshold')} with 4 min easy`,
  },
  {
    id: 'thr-2x20',
    label: 'Threshold 20s',
    zone: 'threshold',
    work(wm, z) {
      const each = clampInt(wm / 2, 10, 25);
      const t = targetLabel(z, 'threshold');
      return [
        intervalWork('threshold', 2, each * 60, 8 * 60, z,
          `2 × ${each} min @ ${t} · 8 min easy between — steady, hold form through the second rep`),
      ];
    },
    prose: (wm, z) => `2 × ${clampInt(wm / 2, 10, 25)} min @ ${targetLabel(z, 'threshold')} with 8 min easy`,
  },
  {
    id: 'thr-over-under',
    label: 'Over-unders',
    zone: 'threshold',
    work(wm, z) {
      // Blocks of 3 × (2 min "over" @ ~top of threshold / 2 min "under" @ ~bottom),
      // i.e. ~12 min work each. Fill workMinutes with 2–4 such blocks.
      const blocks = clampInt(wm / 12, 2, 4);
      const t = targetLabel(z, 'threshold');
      return [
        intervalWork('threshold', blocks, 12 * 60, 5 * 60, z,
          `${blocks} × [3 × (2 min over / 2 min under)] around ${t} · 5 min easy between blocks — surge and settle without going anaerobic`),
      ];
    },
    prose: (wm, z) => `${clampInt(wm / 12, 2, 4)} × (3× 2min over / 2min under) around ${targetLabel(z, 'threshold')}`,
  },
];

const VO2MAX_TEMPLATES: BikeQualityTemplate[] = [
  {
    id: 'vo2-5x3',
    label: 'VO2 3s',
    zone: 'vo2max',
    work(wm, z) {
      const reps = clampInt(wm / 3, 4, 6);
      const t = targetLabel(z, 'vo2max');
      return [
        intervalWork('vo2max', reps, 3 * 60, 3 * 60, z,
          `${reps} × 3 min @ ${t} · 3 min easy spin (1:1) — even efforts, don't blow the first`),
      ];
    },
    prose: (wm, z) => `${clampInt(wm / 3, 4, 6)} × 3 min @ ${targetLabel(z, 'vo2max')} with 3 min easy`,
  },
  {
    id: 'vo2-5x4',
    label: 'VO2 4s',
    zone: 'vo2max',
    work(wm, z) {
      const reps = clampInt(wm / 4, 4, 6);
      const t = targetLabel(z, 'vo2max');
      return [
        intervalWork('vo2max', reps, 4 * 60, 4 * 60, z,
          `${reps} × 4 min @ ${t} · 4 min easy spin (1:1) — hold the target to the last rep`),
      ];
    },
    prose: (wm, z) => `${clampInt(wm / 4, 4, 6)} × 4 min @ ${targetLabel(z, 'vo2max')} with 4 min easy`,
  },
  {
    id: 'vo2-30-30',
    label: '30/30s',
    zone: 'vo2max',
    work(wm, z) {
      // Sets of 10 × (30 s hard / 30 s easy) = ~10 min each; 5 min between sets.
      const sets = clampInt(wm / 10, 2, 3);
      const t = targetLabel(z, 'vo2max');
      return [
        intervalWork('vo2max', sets, 10 * 60, 5 * 60, z,
          `${sets} × (10 × 30 s @ ${t} / 30 s easy) · 5 min easy between sets — punchy, repeatable`),
      ];
    },
    prose: (wm, z) => `${clampInt(wm / 10, 2, 3)} × (10 × 30/30) @ ${targetLabel(z, 'vo2max')}`,
  },
];

const ANAEROBIC_TEMPLATES: BikeQualityTemplate[] = [
  {
    id: 'ana-6x1',
    label: 'Anaerobic 1s',
    zone: 'anaerobic',
    work(wm, z) {
      // ~1 min hard + 3 min easy = 4 min cycle.
      const reps = clampInt(wm / 4, 4, 8);
      const t = targetLabel(z, 'anaerobic');
      return [
        intervalWork('anaerobic', reps, 60, 3 * 60, z,
          `${reps} × 1 min @ ${t} · 3 min easy spin between — hard from the gun, tracked by duration not TSS`),
      ];
    },
    prose: (wm, z) => `${clampInt(wm / 4, 4, 8)} × 1 min @ ${targetLabel(z, 'anaerobic')} with 3 min easy`,
  },
];

const SPRINT_TEMPLATES: BikeQualityTemplate[] = [
  {
    id: 'spr-8x15',
    label: 'Neuromuscular 15s',
    zone: 'sprint',
    work(wm, z) {
      // ~15 s max + full recovery (~4 min) = ~4 min cycle.
      const reps = clampInt(wm / 4, 6, 10);
      const t = targetLabel(z, 'sprint');
      return [
        intervalWork('sprint', reps, 15, 4 * 60, z,
          `${reps} × 15 s max @ ${t} · full recovery (3–5 min) between — all-out, quality over quantity`),
      ];
    },
    prose: (wm, _z) => `${clampInt(wm / 4, 6, 10)} × 15 s max, full recovery`,
  },
];

const TEMPLATES: Partial<Record<PowerZoneKey, BikeQualityTemplate[]>> = {
  tempo: TEMPO_TEMPLATES,
  sweetspot: SWEETSPOT_TEMPLATES,
  threshold: THRESHOLD_TEMPLATES,
  vo2max: VO2MAX_TEMPLATES,
  anaerobic: ANAEROBIC_TEMPLATES,
  sprint: SPRINT_TEMPLATES,
};

/** Pick a template for a zone by a deterministic seed (variety week-to-week). */
function pickTemplate(zone: PowerZoneKey, seed: number): BikeQualityTemplate | null {
  const list = TEMPLATES[zone];
  if (!list || list.length === 0) return null;
  const i = ((seed % list.length) + list.length) % list.length;
  return list[i];
}

// --- warm-up / cool-down / continuous fallback --------------------------------

function warmupSegment(wuCdMinutes: number, zones: PowerZones): WorkoutSegment {
  return {
    role: 'warmup',
    zone: 'endurance',
    durationSeconds: Math.round(wuCdMinutes * 60),
    ...wattTargets(zones, 'endurance'),
    note: `${wuCdMinutes} min building recovery→endurance @ ${targetLabel(zones, 'endurance')}, then 2–3 × 30 s openers to VO2 to sharpen the legs`,
  };
}
function cooldownSegment(wuCdMinutes: number, zones: PowerZones): WorkoutSegment {
  return {
    role: 'cooldown',
    zone: 'recovery',
    durationSeconds: Math.round(wuCdMinutes * 60),
    ...wattTargets(zones, 'recovery'),
    note: `${wuCdMinutes} min easy spin @ ${targetLabel(zones, 'recovery')} — let the heart rate come down`,
  };
}

/** Continuous block — the fallback for zones without a template (endurance/recovery). */
function continuousWork(zone: PowerZoneKey, workMinutes: number, zones: PowerZones): WorkoutSegment {
  const m = Math.round(workMinutes);
  return {
    role: 'work',
    zone,
    durationSeconds: m * 60,
    ...wattTargets(zones, zone),
    note: `${m} min continuous @ ${targetLabel(zones, zone)} — one steady aerobic effort`,
  };
}

// --- public API (mirrors workouts.ts exactly) ---------------------------------

/**
 * Build the full structured cycling session (warm-up → main set → cool-down) for
 * a quality day. `workMinutes` is the target on-power time; `wuCdMinutes` is the
 * warm-up (and cool-down) length. `seed` selects the template variant so weeks
 * vary. Zones without a template (endurance/recovery) fall back to a continuous
 * block. The twin of `workouts.ts#buildQualitySegments`.
 */
export function buildBikeQualitySegments(
  dayMinutes: number,
  zone: PowerZoneKey,
  zones: PowerZones,
  workMinutes: number,
  wuCdMinutes: number,
  seed: number,
): WorkoutSegment[] {
  void dayMinutes; // total is warm-up + work + cool-down; kept for seam parity.
  const template = pickTemplate(zone, seed);
  const work = template ? template.work(workMinutes, zones) : [continuousWork(zone, workMinutes, zones)];
  return [warmupSegment(wuCdMinutes, zones), ...work, cooldownSegment(wuCdMinutes, zones)];
}

/** Prose mirror of the chosen cycling session. Twin of `buildQualityDescription`. */
export function buildBikeQualityDescription(
  dayMinutes: number,
  zone: PowerZoneKey,
  zones: PowerZones,
  workMinutes: number,
  wuCdMinutes: number,
  seed: number,
): string {
  const template = pickTemplate(zone, seed);
  const main = template
    ? `${template.label} — ${template.prose(workMinutes, zones)}`
    : `${Math.round(workMinutes)} min @ ${targetLabel(zones, zone)}`;
  return `${cap(main)}; ${wuCdMinutes} min warm-up + openers and ${wuCdMinutes} min cool-down (${Math.round(dayMinutes)} min total)`;
}
