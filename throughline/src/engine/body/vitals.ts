/**
 * Vitals vs the athlete's own HEALTHY baseline, and episode detection.
 * Pure: no DB, no clock.
 *
 * Why this replaced the old rolling z-score:
 *
 *  1. The old baseline was a 60-day mean that included the days it judged.
 *     Weeks of illness dragged "normal" toward the sick values, so the alarm
 *     faded exactly when it mattered. Here the reference is the PRIOR 56 days,
 *     uses median + MAD (a few bad nights don't move it), and EXCLUDES days
 *     inside a detected episode, so being ill does not become the new normal.
 *
 *  2. Illness and deep fatigue show up as several signals drifting together
 *     for several days. So each day's vitals are combined into one composite
 *     in standard units ("strain"), and detection runs on its PERSISTENCE over
 *     3 and 7 days. That is far more sensitive to a sustained shift than any
 *     single reading, and far less likely to fire on one bad night. (A naive
 *     per-day sum across six vitals false-alarms about 20 times a year.)
 *
 *  3. A lasting real change (altitude, a new device) must not alarm forever:
 *     excluded days age back into the reference after 35 days, so the baseline
 *     accepts a new normal within about seven weeks. The athlete can accept it
 *     at once ("I feel fine").
 */
import { addDays, dayNumber } from '../dates';
import type { DailyReading } from '../types';

export type VitalKey = 'hrv' | 'resting_hr' | 'respiratory_rate' | 'skin_temp' | 'spo2' | 'sleep';

export interface VitalSpec {
  key: VitalKey;
  label: string;
  unit: string;
  /** Which direction is the worrying one. */
  bad: 'low' | 'high';
  /** HRV is right-skewed; compare it on a log scale (standard practice). */
  ln?: boolean;
  /** Minimum spread (same scale as the comparison) so tiny variance can't alarm. */
  sdFloor: number;
  /** Weight in the day's composite. */
  weight: number;
  /** Illness-specific markers: they rise with infection, not with hard training. */
  illnessMarker?: boolean;
  decimals: number;
}

export const VITALS: Record<VitalKey, VitalSpec> = {
  hrv: { key: 'hrv', label: 'HRV', unit: 'ms', bad: 'low', ln: true, sdFloor: 0.07, weight: 1, decimals: 0 },
  resting_hr: { key: 'resting_hr', label: 'Resting HR', unit: 'bpm', bad: 'high', sdFloor: 1.5, weight: 1, decimals: 0 },
  respiratory_rate: { key: 'respiratory_rate', label: 'Breathing rate', unit: '/min', bad: 'high', sdFloor: 0.3, weight: 1.2, illnessMarker: true, decimals: 1 },
  skin_temp: { key: 'skin_temp', label: 'Skin temperature', unit: '°C', bad: 'high', sdFloor: 0.2, weight: 1.2, illnessMarker: true, decimals: 1 },
  spo2: { key: 'spo2', label: 'Blood oxygen', unit: '%', bad: 'low', sdFloor: 0.7, weight: 0.6, illnessMarker: true, decimals: 1 },
  sleep: { key: 'sleep', label: 'Sleep', unit: 'h', bad: 'low', sdFloor: 0.6, weight: 0.4, decimals: 1 },
};
export const VITAL_KEYS = Object.keys(VITALS) as VitalKey[];

export type VitalSeries = Partial<Record<VitalKey, DailyReading[]>>;

export interface VitalReading {
  value: number;
  /** The athlete's usual value and normal range (±1 spread), in display units. Null while the baseline forms. */
  usual: number | null;
  lo: number | null;
  hi: number | null;
  /** Standard deviations from usual, signed so that POSITIVE = worse. Null without a baseline. */
  bad: number | null;
}

export type DayLevel = 'normal' | 'watch' | 'abnormal';

export interface BodyDay {
  day: string;
  vitals: Partial<Record<VitalKey, VitalReading>>;
  /** The day's composite deviation in standard units: 0 = usual, positive = worse. Null if nothing could be judged. */
  strain: number | null;
  /** Persistence of the composite over the last 3 and 7 days, in standard units. */
  strain3: number | null;
  strain7: number | null;
  /** Vitals at least 1.5 spreads worse than usual today. */
  flagged: VitalKey[];
  level: DayLevel;
  /** How many vitals had a baseline to be judged against. */
  scored: number;
  /** This day falls inside a detected episode. */
  inEpisode: boolean;
}

export interface WalkedEpisode {
  startedOn: string;
  /** The day the detector first recognised it (always on or after startedOn). */
  detectedOn: string;
  /** Last day inside the episode; null while it is still active at the end of the data. */
  endedOn: string | null;
  days: string[];
  peakStrain: number;
}

export interface WalkResult {
  days: BodyDay[];
  episodes: WalkedEpisode[];
  /** An episode is active on the latest observed day. */
  active: WalkedEpisode | null;
}

export interface WalkOptions {
  windowDays?: number;
  minRef?: number;
  /** How long an episode day stays out of the reference. */
  excludeForDays?: number;
  /** Ranges the athlete told us are normal for them: never treated as an episode. */
  accept?: { from: string; to: string }[];
}

// Detection thresholds, in standard units of the composite. Calibrated by
// simulation (see body.test.ts) to under ~0.3 false episodes per athlete-year
// with correlated, autocorrelated noise, while catching a mild illness within
// about three days.
export const LEVEL_WATCH = 1.75;
export const LEVEL_ABNORMAL = 2.5;
const ENTER_3 = 3.6;
const ENTER_7 = 3.8;
const ENTER_AUTO = 4.2; // HRV + resting HR on their own
const EXIT_3 = 1.5;
const BAD_CAP = 3;
const MAX_GAP = 4; // days without data that end an episode

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const robustSd = (xs: number[]): number => {
  const c = median(xs);
  return 1.4826 * median(xs.map((v) => Math.abs(v - c)));
};

/**
 * Judge every day up to `asOf` against the healthy baseline that existed on
 * that day, and track episodes with hysteresis (hard to enter, slow to leave).
 * Causal: a day's verdict uses only earlier days, so re-running it tomorrow
 * never rewrites yesterday.
 */
export function walkVitals(series: VitalSeries, asOf: string, opts: WalkOptions = {}): WalkResult {
  const windowDays = opts.windowDays ?? 56;
  const minRef = opts.minRef ?? 10;
  const excludeFor = opts.excludeForDays ?? 35;
  const end = dayNumber(asOf);

  // Dense per-vital arrays indexed by day offset (NaN = no reading).
  let first = Infinity;
  const raw = {} as Record<VitalKey, Map<number, number[]>>;
  for (const k of VITAL_KEYS) {
    raw[k] = new Map();
    for (const r of series[k] ?? []) {
      const dn = dayNumber(r.day);
      // Skin temperature may be reported as a deviation, so it can be negative.
      if (dn > end || !Number.isFinite(r.value) || (k !== 'skin_temp' && r.value <= 0)) continue;
      raw[k].set(dn, [...(raw[k].get(dn) ?? []), r.value]);
      if (dn < first) first = dn;
    }
  }
  if (!Number.isFinite(first)) return { days: [], episodes: [], active: null };
  const n = end - first + 1;
  const val = {} as Record<VitalKey, Float64Array>;
  for (const k of VITAL_KEYS) {
    val[k] = new Float64Array(n).fill(NaN);
    for (const [dn, vs] of raw[k]) val[k][dn - first] = vs.reduce((a, b) => a + b, 0) / vs.length;
  }
  const acceptIdx = (opts.accept ?? []).map((r) => [dayNumber(r.from) - first, dayNumber(r.to) - first] as const);
  const accepted = (i: number) => acceptIdx.some(([a, b]) => i >= a && i <= b);

  const isEpisodeDay = new Uint8Array(n);
  // Two detection channels, each self-calibrated:
  //   [0] every vital combined: catches illness (breathing rate, temperature…);
  //   [1] HRV + resting HR only: catches fatigue/overreaching, which moves the
  //       autonomic pair and nothing else, and would be diluted in channel 0.
  const CH = 2;
  const rawCh = Array.from({ length: CH }, () => new Float64Array(n).fill(NaN)); // before self-calibration
  const ch = Array.from({ length: CH }, () => new Float64Array(n).fill(NaN));
  const strain = new Float64Array(n).fill(NaN); // max over channels, for display
  const badOf = {} as Record<VitalKey, Float64Array>;
  for (const k of VITAL_KEYS) badOf[k] = new Float64Array(n).fill(NaN);

  const out: (BodyDay | null)[] = new Array(n).fill(null);
  const episodes: WalkedEpisode[] = [];
  let active: { start: number; trigger: number; peak: number } | null = null;
  let lastObs = -1;

  /** Persistence of one channel over a window: mean × √n, in standard units. */
  const windowStat = (arr: Float64Array, i: number, span: number, minObs: number): number | null => {
    let sum = 0;
    let c = 0;
    for (let j = Math.max(0, i - span + 1); j <= i; j++) {
      if (!Number.isNaN(arr[j])) {
        sum += arr[j];
        c++;
      }
    }
    return c >= minObs ? (sum / c) * Math.sqrt(c) : null;
  };
  const maxStat = (i: number, span: number, minObs: number): number | null => {
    const vs = ch.map((arr) => windowStat(arr, i, span, minObs)).filter((v): v is number => v != null);
    return vs.length ? Math.max(...vs) : null;
  };
  const vitalsAgree = (i: number, span: number, floor: number): number => {
    let agree = 0;
    for (const k of VITAL_KEYS) {
      let sum = 0;
      let c = 0;
      for (let j = Math.max(0, i - span + 1); j <= i; j++) {
        if (!Number.isNaN(badOf[k][j])) {
          sum += badOf[k][j];
          c++;
        }
      }
      if (c >= 2 && sum / c >= floor) agree++;
    }
    return agree;
  };
  const pairAgrees = (i: number, span: number, floor: number): boolean => {
    for (const k of ['hrv', 'resting_hr'] as const) {
      let sum = 0;
      let c = 0;
      for (let j = Math.max(0, i - span + 1); j <= i; j++) {
        if (!Number.isNaN(badOf[k][j])) {
          sum += badOf[k][j];
          c++;
        }
      }
      if (c < 2 || sum / c < floor) return false;
    }
    return true;
  };
  const closeEpisode = (lastIdx: number) => {
    if (!active) return;
    const days: string[] = [];
    for (let j = active.start; j <= lastIdx; j++) if (isEpisodeDay[j]) days.push(addDays(asOf, j - (n - 1)));
    episodes.push({ startedOn: addDays(asOf, active.start - (n - 1)), detectedOn: addDays(asOf, active.trigger - (n - 1)), endedOn: addDays(asOf, lastIdx - (n - 1)), days, peakStrain: active.peak });
    active = null;
  };

  for (let i = 0; i < n; i++) {
    const vitals: Partial<Record<VitalKey, VitalReading>> = {};
    let num = 0;
    let den = 0;
    let scored = 0;
    let any = false;
    const flagged: VitalKey[] = [];
    let agreeToday = 0;

    for (const k of VITAL_KEYS) {
      const value = val[k][i];
      if (Number.isNaN(value)) continue;
      any = true;
      const spec = VITALS[k];
      const tx = (v: number) => (spec.ln ? Math.log(v) : v);
      const inv = (v: number) => (spec.ln ? Math.exp(v) : v);
      const ref: number[] = [];
      for (let j = Math.max(0, i - windowDays); j < i; j++) {
        const v = val[k][j];
        if (Number.isNaN(v)) continue;
        if (isEpisodeDay[j] && i - j <= excludeFor) continue;
        ref.push(tx(v));
      }
      if (ref.length < minRef) {
        vitals[k] = { value, usual: null, lo: null, hi: null, bad: null };
        continue;
      }
      const center = median(ref);
      const sd = Math.max(robustSd(ref), spec.sdFloor);
      const z = (tx(value) - center) / sd;
      const bad = spec.bad === 'high' ? z : -z;
      vitals[k] = { value, usual: inv(center), lo: inv(center - sd), hi: inv(center + sd), bad };
      badOf[k][i] = Math.max(-BAD_CAP, Math.min(BAD_CAP, bad));
      scored++;
      num += spec.weight * badOf[k][i];
      den += spec.weight * spec.weight;
      if (bad >= 1.5) flagged.push(k);
      if (bad >= 1) agreeToday++;
    }
    if (!any) continue;

    const calibrate = (c: number, rawValue: number) => {
      rawCh[c][i] = rawValue;
      // Self-calibrate: real vitals are correlated and heavy-tailed, so scale
      // by how much THIS athlete's composite normally varies (never below 1).
      const hist: number[] = [];
      for (let j = Math.max(0, i - windowDays); j < i; j++) {
        if (!Number.isNaN(rawCh[c][j]) && !(isEpisodeDay[j] && i - j <= excludeFor)) hist.push(rawCh[c][j]);
      }
      const scale = hist.length >= 14 ? Math.max(1, robustSd(hist)) : 1.25;
      ch[c][i] = rawValue / scale;
    };
    if (scored > 0) calibrate(0, num / Math.sqrt(den));
    const bh = badOf.hrv[i];
    const br = badOf.resting_hr[i];
    if (!Number.isNaN(bh) && !Number.isNaN(br)) calibrate(1, (bh + br) / Math.SQRT2);
    if (scored > 0) strain[i] = Math.max(ch[0][i], Number.isNaN(ch[1][i]) ? -Infinity : ch[1][i]);

    const s = Number.isNaN(strain[i]) ? null : strain[i];
    const s3 = s == null ? null : maxStat(i, 3, 2);
    const s7 = s == null ? null : maxStat(i, 7, 4);
    const level: DayLevel = s != null && s >= LEVEL_ABNORMAL && agreeToday >= 2 ? 'abnormal' : s != null && s >= LEVEL_WATCH ? 'watch' : 'normal';

    // --- Episode tracking (hysteresis) ---
    if (active && lastObs >= 0 && i - lastObs > MAX_GAP) closeEpisode(lastObs); // lost the signal
    if (s != null && !accepted(i)) {
      if (!active) {
        const c0 = ch[0][i];
        const prev = lastObs >= 0 && i - lastObs <= 2 && !Number.isNaN(ch[0][lastObs]) ? ch[0][lastObs] : null;
        const twoStrong = c0 >= LEVEL_ABNORMAL && prev != null && prev >= LEVEL_ABNORMAL && agreeToday >= 2;
        const all3 = windowStat(ch[0], i, 3, 2);
        const all7 = windowStat(ch[0], i, 7, 4);
        const fast = all3 != null && all3 >= ENTER_3 && vitalsAgree(i, 3, 1) >= 2;
        const slow = all7 != null && all7 >= ENTER_7 && vitalsAgree(i, 7, 0.7) >= 2;
        // The autonomic pair alone needs a higher bar and BOTH signals agreeing.
        const auto3 = windowStat(ch[1], i, 3, 2);
        const auto7 = windowStat(ch[1], i, 7, 4);
        const autoFast = auto3 != null && auto3 >= ENTER_AUTO && pairAgrees(i, 3, 1);
        const autoSlow = auto7 != null && auto7 >= ENTER_AUTO && pairAgrees(i, 7, 0.75);
        if (twoStrong || fast || slow || autoFast || autoSlow) {
          // Start where it began: walk back over the run-up of elevated days.
          let start = i;
          for (let j = i - 1, gap = 0; j >= Math.max(0, i - 10) && gap <= 1; j--) {
            if (Number.isNaN(strain[j])) {
              gap++;
              continue;
            }
            if (strain[j] < 1 || isEpisodeDay[j] || accepted(j)) break;
            start = j;
            gap = 0;
          }
          active = { start, trigger: i, peak: s };
          for (let j = start; j <= i; j++) {
            if (!Number.isNaN(strain[j])) {
              isEpisodeDay[j] = 1;
              if (out[j]) out[j]!.inEpisode = true;
              active.peak = Math.max(active.peak, strain[j]);
            }
          }
        }
      } else if (s3 != null && s3 < EXIT_3 && s < LEVEL_WATCH) {
        closeEpisode(lastObs); // back in range: today is clear
      } else {
        isEpisodeDay[i] = 1;
        active.peak = Math.max(active.peak, s);
      }
    } else if (active && accepted(i)) {
      closeEpisode(lastObs);
    }

    out[i] = {
      day: addDays(asOf, i - (n - 1)),
      vitals,
      strain: s == null ? null : Math.round(s * 100) / 100,
      strain3: s3 == null ? null : Math.round(s3 * 100) / 100,
      strain7: s7 == null ? null : Math.round(s7 * 100) / 100,
      flagged,
      level,
      scored,
      inEpisode: isEpisodeDay[i] === 1,
    };
    lastObs = i;
  }

  let current: WalkedEpisode | null = null;
  if (active) {
    const a = active as { start: number; trigger: number; peak: number };
    const days: string[] = [];
    for (let j = a.start; j < n; j++) if (isEpisodeDay[j]) days.push(addDays(asOf, j - (n - 1)));
    current = { startedOn: addDays(asOf, a.start - (n - 1)), detectedOn: addDays(asOf, a.trigger - (n - 1)), endedOn: null, days, peakStrain: a.peak };
  }
  return { days: out.filter((d): d is BodyDay => d != null), episodes, active: current };
}

/** Plain-language deviation for one vital, e.g. "Resting HR 58 bpm, 7 above your usual 51". */
export function describeVital(key: VitalKey, r: VitalReading): string | null {
  if (r.usual == null || r.bad == null) return null;
  const spec = VITALS[key];
  const f = (v: number) => v.toFixed(spec.decimals);
  const diff = r.value - r.usual;
  const dir = diff < 0 ? 'below' : 'above';
  if (key === 'hrv' || key === 'sleep') {
    const pct = Math.round((Math.abs(diff) / r.usual) * 100);
    return `${spec.label} ${f(r.value)} ${spec.unit}, ${pct}% ${dir} your usual ${f(r.usual)}`;
  }
  const unit = spec.unit === 'bpm' ? ' bpm' : spec.unit;
  return `${spec.label} ${f(r.value)}${unit}, ${Math.abs(diff).toFixed(key === 'resting_hr' ? 0 : 1)} ${dir} your usual ${f(r.usual)}`;
}
