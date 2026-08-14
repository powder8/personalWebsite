/**
 * Unit tests for the load-currency CUTOVER flag (spec story L2): the pure
 * `resolveLoadCurrency` precedence + the per-row `selectDailyLoad` swap that
 * fitness.ts / insights.ts share. Zero new deps — Node's test runner via tsx.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveLoadCurrency,
  parseLoadCurrency,
  DEFAULT_LOAD_CURRENCY,
} from '../loadCurrencyFlagLogic';
import { selectDailyLoad, NO_ANCHORS, type LoadRow, type AthleteLoadAnchors } from '../loadSelectLogic';
import { estimateLoad } from '../load';
import { computeFitnessFatigue } from '../fitnessFatigue';

// ── flag resolution / precedence ───────────────────────────────────────────────

test('resolveLoadCurrency: defaults to tss when nothing is set (live cutover)', () => {
  assert.equal(DEFAULT_LOAD_CURRENCY, 'tss');
  assert.equal(resolveLoadCurrency(undefined, undefined), 'tss');
  assert.equal(resolveLoadCurrency(null, null), 'tss');
  assert.equal(resolveLoadCurrency('', ''), 'tss');
  // The env escape hatch still forces the legacy proxy.
  assert.equal(resolveLoadCurrency('trimp', undefined), 'trimp');
});

test('resolveLoadCurrency: setting is used when env is unset/invalid', () => {
  assert.equal(resolveLoadCurrency(undefined, 'tss'), 'tss');
  assert.equal(resolveLoadCurrency('garbage', 'tss'), 'tss');
  assert.equal(resolveLoadCurrency(null, 'trimp'), 'trimp');
});

test('resolveLoadCurrency: env overrides the stored setting', () => {
  assert.equal(resolveLoadCurrency('trimp', 'tss'), 'trimp');
  assert.equal(resolveLoadCurrency('tss', 'trimp'), 'tss');
});

test('parseLoadCurrency: only trimp/tss (case/space-insensitive), else null', () => {
  assert.equal(parseLoadCurrency('  TSS '), 'tss');
  assert.equal(parseLoadCurrency('Trimp'), 'trimp');
  assert.equal(parseLoadCurrency('watts'), null);
  assert.equal(parseLoadCurrency(null), null);
});

// ── the currency swap (selectDailyLoad) ────────────────────────────────────────

const baseRow: LoadRow = {
  sport: 'run',
  durationSeconds: 3600,
  distanceMeters: 12000,
  avgHr: null,
  avgPaceSecPerKm: 300, // 5:00/km
  maxHr: 185,
  trainingLoad: 90, // legacy TRIMP
  trainingLoadTss: 55, // backfilled TSS-equivalent
};

test('flag OFF (trimp): selectDailyLoad returns the legacy TRIMP value', () => {
  const got = selectDailyLoad(baseRow, 'trimp', NO_ANCHORS);
  assert.equal(got.value, 90);
  assert.equal(got.estimated, false);
  assert.equal(got.source, 'trimp');
});

test('flag OFF (trimp): byte-identical to estimateLoad volume proxy when trainingLoad is null', () => {
  const row: LoadRow = { ...baseRow, trainingLoad: null };
  const got = selectDailyLoad(row, 'trimp', NO_ANCHORS);
  // Exactly what fitness.ts/insights.ts computed pre-cutover: estimateLoad w/ NO hr.
  const legacy = estimateLoad({ durationSeconds: 3600, avgHr: null, distanceMeters: 12000 });
  assert.equal(got.value, legacy.load); // 60 min × 0.7 = 42
  assert.equal(got.value, 42);
  assert.equal(got.estimated, legacy.estimated);
  assert.equal(got.estimated, true);
});

test('flag OFF ignores trainingLoadTss entirely (default currency is unchanged)', () => {
  // Even with a wildly different TSS column, trimp mode never reads it.
  const row: LoadRow = { ...baseRow, trainingLoadTss: 9999 };
  assert.equal(selectDailyLoad(row, 'trimp', NO_ANCHORS).value, 90);
});

test('flag ON (tss): the PMC consumes activities.trainingLoadTss, not TRIMP', () => {
  const got = selectDailyLoad(baseRow, 'tss', NO_ANCHORS);
  assert.equal(got.value, 55); // the backfilled TSS-equivalent, not 90
  assert.equal(got.source, 'tss-backfilled');
});

test('flag ON (tss): a full PMC series is built from trainingLoadTss', () => {
  // Two currencies, same days: the CTL must reflect whichever column is selected.
  const rows: LoadRow[] = Array.from({ length: 30 }, () => baseRow);
  const days = rows.map((_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);

  const tssSeries = computeFitnessFatigue(
    rows.map((r, i) => ({ day: days[i], value: selectDailyLoad(r, 'tss', NO_ANCHORS).value })),
    days[0],
    days[days.length - 1],
  );
  const trimpSeries = computeFitnessFatigue(
    rows.map((r, i) => ({ day: days[i], value: selectDailyLoad(r, 'trimp', NO_ANCHORS).value })),
    days[0],
    days[days.length - 1],
  );

  const tssCtl = tssSeries[tssSeries.length - 1].ctl;
  const trimpCtl = trimpSeries[trimpSeries.length - 1].ctl;
  // TSS load (55) < TRIMP load (90) ⇒ the renumbered curve is lower — it genuinely
  // consumed the new column. The PMC is linear in daily load, so with identical
  // days the two CTLs scale EXACTLY by the load ratio 55/90.
  assert.ok(tssCtl > 0 && trimpCtl > 0);
  assert.ok(tssCtl < trimpCtl);
  assert.ok(Math.abs(tssCtl / trimpCtl - 55 / 90) < 0.01);
});

test('flag ON (tss) null-backfill fallback: computes on the fly from pace + anchors', () => {
  const row: LoadRow = { ...baseRow, trainingLoadTss: null };
  const anchors: AthleteLoadAnchors = {
    thresholdPaceSecPerKm: 285, // ~4:45/km threshold; the run above at 5:00/km is sub-threshold
    ftpWatts: null,
    lthrBpm: null,
    sex: 'male',
  };
  const got = selectDailyLoad(row, 'tss', anchors);
  assert.equal(got.source, 'pace'); // rTSS rung fired
  // IF = 285/300 = 0.95; load = 0.95² × 1h × 100 ≈ 90.25
  assert.ok(Math.abs(got.value - 90.25) < 0.5);
});

test('flag ON (tss) null-backfill fallback: no anchors → estimated tier, still non-zero', () => {
  const row: LoadRow = { ...baseRow, trainingLoadTss: null, avgHr: null };
  const got = selectDailyLoad(row, 'tss', NO_ANCHORS);
  assert.equal(got.source, 'estimated'); // zone/duration fallback
  assert.ok(got.value > 0); // never drops the row
  assert.equal(got.estimated, true);
});

test('flag ON (tss) null-backfill fallback: zero-usable-data row falls back to legacy', () => {
  // durationSeconds 0 ⇒ estimateLoadTss yields 0 ⇒ legacy currency for the row.
  const row: LoadRow = {
    ...baseRow,
    durationSeconds: 0,
    distanceMeters: null,
    avgPaceSecPerKm: null,
    trainingLoadTss: null,
    trainingLoad: 77,
  };
  const got = selectDailyLoad(row, 'tss', NO_ANCHORS);
  assert.equal(got.value, 77);
  assert.equal(got.source, 'trimp');
});
