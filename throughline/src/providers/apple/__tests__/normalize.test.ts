import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAppleHealth, appleDay } from '../normalize';

test('appleDay extracts the calendar day from exporter + ISO dates', () => {
  assert.equal(appleDay('2026-08-18 07:12:00 +0000'), '2026-08-18');
  assert.equal(appleDay('2026-08-18T07:12:00Z'), '2026-08-18');
  assert.equal(appleDay(undefined), null);
  assert.equal(appleDay('not-a-date'), null);
});

test('HRV + resting HR map to their day records', () => {
  const batch = normalizeAppleHealth({
    data: {
      metrics: [
        { name: 'heart_rate_variability', units: 'ms', data: [{ date: '2026-08-18 03:00:00 +0000', qty: 64.5 }] },
        { name: 'resting_heart_rate', units: 'count/min', data: [{ date: '2026-08-18 03:00:00 +0000', qty: 47.8 }] },
      ],
    },
  });
  assert.equal(batch.hrvRecords?.length, 1);
  assert.equal(batch.hrvRecords![0].day, '2026-08-18');
  assert.equal(batch.hrvRecords![0].overnightAvgMs, 64.5);
  assert.equal(batch.restingHrRecords?.length, 1);
  assert.equal(batch.restingHrRecords![0].restingHr, 48, 'rounded to nearest bpm');
});

test('sleep_analysis with stage breakdown → seconds; total = explicit asleep when present', () => {
  const batch = normalizeAppleHealth({
    data: {
      metrics: [
        {
          name: 'sleep_analysis',
          units: 'hr',
          data: [{ date: '2026-08-18 07:00:00 +0000', asleep: 7.5, deep: 1.0, rem: 1.5, core: 5.0, awake: 0.4 }],
        },
      ],
    },
  });
  const s = batch.sleepRecords![0];
  assert.equal(s.day, '2026-08-18');
  assert.equal(s.totalSleepSeconds, Math.round(7.5 * 3600));
  assert.equal(s.deepSeconds, 3600);
  assert.equal(s.remSeconds, Math.round(1.5 * 3600));
  assert.equal(s.lightSeconds, Math.round(5.0 * 3600), 'core maps to light');
  assert.equal(s.awakeSeconds, Math.round(0.4 * 3600));
});

test('sleep with no explicit total falls back to the sum of stages', () => {
  const batch = normalizeAppleHealth({
    data: { metrics: [{ name: 'sleep_analysis', data: [{ date: '2026-08-18', deep: 1, rem: 1, core: 4 }] }] },
  });
  assert.equal(batch.sleepRecords![0].totalSleepSeconds, Math.round(6 * 3600));
});

test('multiple points per day keep the last; unknown metrics are ignored', () => {
  const batch = normalizeAppleHealth({
    data: {
      metrics: [
        {
          name: 'heart_rate_variability',
          data: [
            { date: '2026-08-18 01:00:00 +0000', qty: 50 },
            { date: '2026-08-18 05:00:00 +0000', qty: 70 },
          ],
        },
        { name: 'step_count', data: [{ date: '2026-08-18', qty: 12000 }] },
      ],
    },
  });
  assert.equal(batch.hrvRecords?.length, 1, 'one row per day');
  assert.equal(batch.hrvRecords![0].overnightAvgMs, 70, 'last point wins');
  // step_count is ignored — no activities/other keys leak in.
  assert.equal(batch.restingHrRecords, undefined);
  assert.equal(batch.sleepRecords, undefined);
});

test('garbage payloads yield an empty batch, never throw', () => {
  assert.deepEqual(normalizeAppleHealth(null), {});
  assert.deepEqual(normalizeAppleHealth({}), {});
  assert.deepEqual(normalizeAppleHealth({ data: { metrics: 'nope' } }), {});
  assert.deepEqual(normalizeAppleHealth({ data: { metrics: [{ name: 'heart_rate_variability' }] } }), {});
});

test('step_count → a daily summary (summed per day)', () => {
  const batch = normalizeAppleHealth({
    data: {
      metrics: [
        { name: 'step_count', units: 'count', data: [
          { date: '2026-08-18 09:00:00 +0000', qty: 5000 },
          { date: '2026-08-18 18:00:00 +0000', qty: 3200 },
          { date: '2026-08-19 12:00:00 +0000', qty: 9100 },
        ] },
      ],
    },
  });
  assert.equal(batch.dailySummaries?.length, 2);
  const d18 = batch.dailySummaries!.find((d) => d.day === '2026-08-18')!;
  assert.equal(d18.steps, 8200, 'intraday buckets summed');
  assert.equal(batch.dailySummaries!.find((d) => d.day === '2026-08-19')!.steps, 9100);
});
