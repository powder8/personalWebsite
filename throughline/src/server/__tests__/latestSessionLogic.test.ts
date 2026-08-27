import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionSummaryView, type LatestSession } from '../latestSessionLogic';

const base: Omit<LatestSession, 'sport'> = {
  activityId: 'a1',
  name: 'Session',
  day: '2026-08-25',
  daysAgo: 2,
  distanceMeters: null,
  durationSeconds: null,
  elevationGainMeters: null,
  avgHr: null,
};

test('a ride reads as SPEED (mph/kph), never a running pace', () => {
  // 40 km in 1:20:00 = 30 km/h.
  const v = buildSessionSummaryView(
    { ...base, sport: 'bike', distanceMeters: 40000, durationSeconds: 80 * 60, elevationGainMeters: 300, avgHr: 142 },
    'mi',
  );
  assert.equal(v.title, 'Latest ride');
  assert.equal(v.emoji, '🚴');
  const speed = v.stats.find((s) => s.label === 'Avg speed')!;
  assert.match(speed.value, /mph$/);
  assert.doesNotMatch(v.summary, /\/mi|\/km/); // not a run pace
  assert.match(v.summary, /mph/);
  // Elevation in feet for miles athletes; meters for km.
  assert.match(v.stats.find((s) => s.label === 'Climbing')!.value, /ft$/);
  assert.equal(buildSessionSummaryView({ ...base, sport: 'bike', distanceMeters: 40000, durationSeconds: 80 * 60, elevationGainMeters: 300 }, 'km').stats.find((s) => s.label === 'Avg speed')!.value.endsWith('kph'), true);
});

test('a swim reads as pace per 100 m', () => {
  // 1500 m in 30:00 → 2:00/100m.
  const v = buildSessionSummaryView(
    { ...base, sport: 'swim', distanceMeters: 1500, durationSeconds: 30 * 60 },
    'mi',
  );
  assert.equal(v.title, 'Latest swim');
  assert.equal(v.stats.find((s) => s.label === 'Pace')!.value, '2:00/100m');
  assert.match(v.summary, /1,500 m/);
});

test('a strength session has no distance, just duration', () => {
  const v = buildSessionSummaryView({ ...base, sport: 'strength', durationSeconds: 45 * 60 }, 'mi');
  assert.equal(v.title, 'Latest strength session');
  assert.equal(v.stats.find((s) => s.label === 'Duration')!.value, '45:00');
  assert.equal(v.stats.find((s) => s.label === 'Distance'), undefined);
});

test('the when-label reads Today / Yesterday / N days ago', () => {
  assert.equal(buildSessionSummaryView({ ...base, sport: 'bike', daysAgo: 0, durationSeconds: 60 }, 'mi').whenLabel, 'Today');
  assert.equal(buildSessionSummaryView({ ...base, sport: 'bike', daysAgo: 1, durationSeconds: 60 }, 'mi').whenLabel, 'Yesterday');
  assert.equal(buildSessionSummaryView({ ...base, sport: 'bike', daysAgo: 4, durationSeconds: 60 }, 'mi').whenLabel, '4 days ago');
});
