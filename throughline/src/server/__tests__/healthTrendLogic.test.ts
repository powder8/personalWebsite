import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHealthTrend, type DailySample } from '../healthTrendLogic';

const TODAY = '2026-09-19';
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** `recent` for the last 7 days, `base` for the 28 before. */
function series(base: number, recent: number): DailySample[] {
  const out: DailySample[] = [];
  for (let i = 34; i >= 0; i--) out.push({ day: addDays(TODAY, -i), value: i <= 6 ? recent : base });
  return out;
}

test('resting HR: LOWER is better — a fall reads as improving', () => {
  const t = buildHealthTrend('resting_hr', series(52, 48), { today: TODAY });
  assert.equal(t.current, 48);
  assert.equal(t.baseline, 52);
  assert.ok(t.deltaPct! < 0);
  assert.equal(t.direction, 'improving');
});

test('HRV: HIGHER is better — the same-shaped fall reads as worsening', () => {
  const t = buildHealthTrend('hrv', series(65, 52), { today: TODAY });
  assert.equal(t.direction, 'worsening');
});

test('weight is NEUTRAL — a drop is "down", never "improving"', () => {
  const t = buildHealthTrend('weight', series(75.0, 73.5), { today: TODAY });
  assert.equal(t.direction, 'down');
  assert.notEqual(t.direction, 'improving' as never);
  // 1% of body mass is the smallest move that counts.
  assert.equal(buildHealthTrend('weight', series(75.0, 74.6), { today: TODAY }).direction, 'steady');
});

test('noise stays steady: HRV wobbles a lot day to day', () => {
  assert.equal(buildHealthTrend('hrv', series(60, 63), { today: TODAY }).direction, 'steady'); // +5% < 8%
  assert.equal(buildHealthTrend('resting_hr', series(50, 51), { today: TODAY }).direction, 'steady'); // +2% < 3%
});

test('sleep and steps: more is better', () => {
  assert.equal(buildHealthTrend('sleep', series(6.8, 7.6), { today: TODAY }).direction, 'improving');
  assert.equal(buildHealthTrend('steps', series(6000, 9500), { today: TODAY }).direction, 'improving');
});

test('weekly medians form a sparkline, oldest → newest, gaps as null', () => {
  const t = buildHealthTrend('resting_hr', series(52, 48), { today: TODAY, weeks: 6 });
  assert.equal(t.weekly.length, 6);
  assert.equal(t.weekly.at(-1), 48, 'the latest week is the recent value');
  assert.equal(t.weekly[0], null, 'no data that far back');
});

test('one reading → a value but no trend; nothing → all null', () => {
  const one = buildHealthTrend('weight', [{ day: TODAY, value: 74.2 }], { today: TODAY });
  assert.equal(one.current, 74.2);
  assert.equal(one.baseline, null);
  assert.equal(one.direction, 'unknown');
  assert.deepEqual(one.latest, { day: TODAY, value: 74.2 });
  const none = buildHealthTrend('hrv', [], { today: TODAY });
  assert.equal(none.current, null);
  assert.equal(none.days, 0);
});

test('junk and out-of-window samples are ignored', () => {
  const t = buildHealthTrend('steps', [
    { day: TODAY, value: 8000 },
    { day: TODAY, value: 0 },
    { day: TODAY, value: NaN },
    { day: '2025-01-01', value: 99999 },
  ], { today: TODAY });
  assert.equal(t.days, 1);
});
