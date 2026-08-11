/**
 * Per-activity daily-load SELECTOR for the fitness/fatigue read path (spec L2).
 *
 * PURE (no `server-only`, no DB): given one activity's fields, the resolved
 * currency, and the athlete's anchors, return the single daily-load number the
 * PMC should sum — plus whether it's a soft/estimated value.
 *
 * This is the ONE place the currency swap happens, shared by `server/fitness.ts`
 * and `server/insights.ts` so they stay in lockstep.
 *
 *   currency = 'trimp' (DEFAULT): BYTE-IDENTICAL to the legacy path —
 *     `activities.trainingLoad` when present (>0), else the legacy volume proxy
 *     (`estimateLoad` with NO hr params → `durMin × 0.7`). Nothing about the
 *     flag-OFF output changes.
 *
 *   currency = 'tss': `activities.trainingLoadTss` when the backfill has populated
 *     it (>0). When it's NULL (not yet backfilled) we DON'T crash or drop the row —
 *     we compute the TSS-equivalent on the fly via `estimateLoadTss` from the
 *     activity's own fields + the athlete anchors; and if even that yields nothing
 *     usable, we fall back to the legacy currency for that row.
 */
import { estimateLoad } from './load';
import { estimateLoadTss, type LoadConfidence } from './loadCurrencyLogic';
import type { LoadCurrency } from './loadCurrencyFlagLogic';
import type { HrParams } from './types';

/**
 * Athlete-level anchors for the on-the-fly TSS fallback. Resolved once per athlete
 * (db/loadCurrencyConfig.ts:resolveAthleteLoadAnchors); `sex` + the row's own
 * `maxHr` synthesize the per-row {@link HrParams} for the hrTSS rung.
 */
export interface AthleteLoadAnchors {
  thresholdPaceSecPerKm: number | null;
  ftpWatts: number | null;
  lthrBpm: number | null;
  sex: string | null; // athletes.sex: 'female' | 'male' | 'other' | null
}

/** Empty anchors — used when currency is 'trimp' (the fallback path never reads them). */
export const NO_ANCHORS: AthleteLoadAnchors = {
  thresholdPaceSecPerKm: null,
  ftpWatts: null,
  lthrBpm: null,
  sex: null,
};

/**
 * Synthesize Banister HrParams from the athlete's sex + this activity's max HR, so
 * the on-the-fly hrTSS fallback has a reserve to work with. Resting HR falls back
 * to a nominal 50 (hrTSS is threshold-relative, so it's insensitive to small
 * resting-HR error). Mirrors scripts/backfill-load-tss.ts:resolveHrParams. Returns
 * null when no usable reserve can be formed.
 */
export function hrParamsFromMaxHr(sex: string | null, maxHr: number | null | undefined): HrParams | null {
  const restingHr = 50;
  const max = maxHr ?? 190;
  if (max - restingHr <= 0) return null;
  const s: 'M' | 'F' | undefined = sex === 'female' ? 'F' : sex === 'male' ? 'M' : undefined;
  return { restingHr, maxHr: max, sex: s };
}

/** The activity fields the selector reads. `durationSeconds` is already derived by the caller. */
export interface LoadRow {
  sport: 'run' | 'bike' | 'swim' | 'strength' | 'cross_train' | 'other';
  durationSeconds: number;
  distanceMeters: number | null;
  avgHr: number | null;
  avgPaceSecPerKm: number | null;
  gapSecPerKm?: number | null;
  maxHr?: number | null;
  /** Legacy TRIMP/volume currency column — what the PMC reads today. */
  trainingLoad: number | null;
  /** New TSS-equivalent column — populated by the L1 backfill. */
  trainingLoadTss: number | null;
}

export interface SelectedLoad {
  value: number;
  /** True when the value is a soft proxy (volume fallback, or low-confidence TSS). */
  estimated: boolean;
  /** Which currency/tier produced it, for diagnostics. */
  source: 'trimp' | 'trimp-proxy' | 'tss-backfilled' | LoadConfidence;
}

/** The legacy TRIMP/volume-proxy selection — the DEFAULT path, byte-identical to pre-cutover. */
function legacyLoad(row: LoadRow): SelectedLoad {
  if (row.trainingLoad != null && row.trainingLoad > 0) {
    return { value: row.trainingLoad, estimated: false, source: 'trimp' };
  }
  const { load, estimated } = estimateLoad({
    durationSeconds: row.durationSeconds,
    avgHr: row.avgHr,
    distanceMeters: row.distanceMeters,
  });
  return { value: load, estimated, source: 'trimp-proxy' };
}

/**
 * The daily load for one activity under the resolved currency.
 *
 * `currency === 'trimp'` returns exactly {@link legacyLoad} (flag-OFF is unchanged).
 */
export function selectDailyLoad(
  row: LoadRow,
  currency: LoadCurrency,
  anchors: AthleteLoadAnchors = NO_ANCHORS,
): SelectedLoad {
  if (currency === 'tss') {
    // 1. Backfilled TSS-equivalent — the normal case after L1.
    if (row.trainingLoadTss != null && row.trainingLoadTss > 0) {
      return { value: row.trainingLoadTss, estimated: false, source: 'tss-backfilled' };
    }
    // 2. Not backfilled → compute on the fly from the activity's own fields.
    const r = estimateLoadTss(
      {
        sport: row.sport,
        durationSeconds: row.durationSeconds,
        avgHr: row.avgHr,
        distanceMeters: row.distanceMeters,
        avgPaceSecPerKm: row.avgPaceSecPerKm,
        gapSecPerKm: row.gapSecPerKm ?? null,
      },
      {
        thresholdPaceSecPerKm: anchors.thresholdPaceSecPerKm,
        ftpWatts: anchors.ftpWatts,
        lthrBpm: anchors.lthrBpm,
        hr: hrParamsFromMaxHr(anchors.sex, row.maxHr),
      },
    );
    if (r.load > 0) return { value: r.load, estimated: r.lowConfidence, source: r.confidence };
    // 3. Nothing usable (e.g. zero duration) → never drop the row; use legacy.
  }
  return legacyLoad(row);
}
