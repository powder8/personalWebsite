import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeGoalProgress, type CtlPoint } from '../goalProgressLogic';

/** Build a daily CTL series from a start value with a per-day delta. */
function series(startDay: string, n: number, start: number, perDay: number): CtlPoint[] {
  const out: CtlPoint[] = [];
  const [y, m, d] = startDay.split('-').map(Number);
  for (let i = 0; i < n; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    out.push({ day, ctl: start + perDay * i });
  }
  return out;
}

test('a rising CTL reads as climbing / on-track with a positive %', () => {
  const p = summarizeGoalProgress(series('2026-06-01', 84, 40, 0.2))!; // 40 → ~56.6
  assert.equal(p.direction, 'climbing');
  assert.equal(p.onTrack, true);
  assert.ok(p.changePct > 3);
  assert.match(p.label, /climbing/i);
});

test('a flat CTL reads as holding, not on-track', () => {
  const p = summarizeGoalProgress(series('2026-06-01', 84, 50, 0))!;
  assert.equal(p.direction, 'holding');
  assert.equal(p.onTrack, false);
  assert.equal(p.changePct, 0);
  assert.match(p.label, /flat/i);
});

test('a falling CTL reads as declining with a negative %', () => {
  const p = summarizeGoalProgress(series('2026-06-01', 84, 60, -0.2))!;
  assert.equal(p.direction, 'declining');
  assert.ok(p.changePct < -3);
  assert.match(p.label, /slipping/i);
});

test('compares against ~6 weeks back and reports the window', () => {
  const p = summarizeGoalProgress(series('2026-06-01', 84, 40, 0.2))!;
  assert.equal(p.windowWeeks, 6, '42-day comparison → 6 weeks');
});

test('a short series still summarizes against its earliest point', () => {
  const p = summarizeGoalProgress(series('2026-08-01', 14, 45, 0.5))!; // only 2 weeks
  assert.ok(p.windowWeeks <= 2);
  assert.equal(p.direction, 'climbing');
});

test('too little data → null (no fake trend)', () => {
  assert.equal(summarizeGoalProgress([]), null);
  assert.equal(summarizeGoalProgress([{ day: '2026-08-01', ctl: 50 }]), null);
});

test('the sparkline is weekly-sampled (roughly one point per week)', () => {
  const p = summarizeGoalProgress(series('2026-06-01', 84, 40, 0.2))!;
  assert.ok(p.spark.length >= 11 && p.spark.length <= 13, `~12 weekly points, got ${p.spark.length}`);
});
