import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAdherence, type AdherenceDay } from '../adaptationLogic';
import type { DayStatus } from '@/server/compliance';

const day = (d: string, status: DayStatus, actualMiles = status === 'done' || status === 'extra' ? 4 : 0): AdherenceDay => ({
  day: d,
  status,
  actualMiles,
  sessionType: status === 'rest' ? 'rest' : 'easy',
});

test('no past days → null (don\'t nag a brand-new athlete)', () => {
  assert.equal(analyzeAdherence({ today: '2026-06-15', days: [], lastRunDay: null }), null);
});

test('on track with a streak → celebratory, shown', () => {
  const days = ['2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14'].map((d) => day(d, 'done'));
  const s = analyzeAdherence({ today: '2026-06-15', days, lastRunDay: '2026-06-14' })!;
  assert.equal(s.tone, 'on_track');
  assert.equal(s.show, true);
  assert.ok(s.streakDays >= 4);
  assert.equal(s.easeBack, null);
});

test('on track but short streak → hidden (stay out of the way)', () => {
  const days = [day('2026-06-13', 'done'), day('2026-06-14', 'done')];
  const s = analyzeAdherence({ today: '2026-06-15', days, lastRunDay: '2026-06-14' })!;
  assert.equal(s.tone, 'on_track');
  assert.equal(s.show, false);
});

test('a missed session while still running → forgiving, no plan change', () => {
  const days = [day('2026-06-11', 'done'), day('2026-06-12', 'missed'), day('2026-06-13', 'rest'), day('2026-06-14', 'done')];
  const s = analyzeAdherence({ today: '2026-06-15', days, lastRunDay: '2026-06-14' })!;
  assert.equal(s.tone, 'slipped');
  assert.equal(s.show, true);
  assert.equal(s.easeBack, null);
  assert.match(s.body, /NOT making up the miles/i);
});

test('short layoff (5 days off) → ease back ~20%, no pace change', () => {
  const days = [day('2026-06-09', 'done'), day('2026-06-10', 'missed'), day('2026-06-11', 'missed'), day('2026-06-12', 'missed'), day('2026-06-13', 'missed'), day('2026-06-14', 'missed')];
  const s = analyzeAdherence({ today: '2026-06-15', days, lastRunDay: '2026-06-10' })!;
  assert.equal(s.tone, 'returning');
  assert.equal(s.layoffDays, 5);
  assert.equal(s.easeBack!.factor, 0.8);
  assert.equal(s.easeBack!.paceEaseSecPerMile, undefined);
  assert.equal(s.easeBack!.rebuildSuggested, false);
});

test('long layoff (20 days) → strong ease + rebuild suggestion', () => {
  const days = [day('2026-05-20', 'done'), day('2026-06-14', 'missed')];
  const s = analyzeAdherence({ today: '2026-06-15', days, lastRunDay: '2026-05-26' })!;
  assert.equal(s.tone, 'returning');
  assert.equal(s.layoffDays, 20);
  assert.equal(s.easeBack!.factor, 0.6);
  assert.equal(s.easeBack!.paceEaseSecPerMile, 15);
  assert.equal(s.easeBack!.rebuildSuggested, true);
});

test('never tells anyone to make up miles (across all tones)', () => {
  const scenarios: { days: AdherenceDay[]; lastRun: string | null }[] = [
    { days: [day('2026-06-12', 'missed'), day('2026-06-13', 'done'), day('2026-06-14', 'done')], lastRun: '2026-06-14' },
    { days: [day('2026-06-08', 'done')], lastRun: '2026-06-08' },
  ];
  for (const sc of scenarios) {
    const s = analyzeAdherence({ today: '2026-06-15', days: sc.days, lastRunDay: sc.lastRun });
    if (s) assert.doesNotMatch(s.body, /make up the (miles|mileage|runs)\b(?!.*niggle)/i);
  }
});
