import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapWhoopSport, normalizeWhoopWorkout, type WhoopWorkout } from '../workouts';

const w = (o: Partial<WhoopWorkout> = {}): WhoopWorkout => ({
  id: 'ecfc6a15-4661-442f-a9a4-f160dd7afae8',
  user_id: 1,
  created_at: '2026-10-16T13:00:00Z',
  updated_at: '2026-10-16T13:00:00Z',
  start: '2026-10-16T12:10:00Z',
  end: '2026-10-16T12:32:00Z',
  sport_name: 'cycling',
  score_state: 'SCORED',
  score: { strain: 8.1, average_heart_rate: 128, max_heart_rate: 151, distance_meter: 7400, altitude_gain_meter: 35 },
  ...o,
});

test('Whoop sport names map onto our sports', () => {
  assert.equal(mapWhoopSport('cycling'), 'bike');
  assert.equal(mapWhoopSport('Mountain Biking'), 'bike');
  assert.equal(mapWhoopSport('spin'), 'bike');
  assert.equal(mapWhoopSport('running'), 'run');
  assert.equal(mapWhoopSport('swimming'), 'swim');
  assert.equal(mapWhoopSport('weightlifting'), 'strength');
  assert.equal(mapWhoopSport('functional fitness'), 'strength');
  assert.equal(mapWhoopSport('walking'), 'cross_train');
  assert.equal(mapWhoopSport('hiking/rucking'), 'cross_train');
  assert.equal(mapWhoopSport('activity'), 'other');
  assert.equal(mapWhoopSport(null), 'other');
});

test('a bike commute becomes a bike activity with its own sourceRef', () => {
  const a = normalizeWhoopWorkout(w())!;
  assert.equal(a.sourceRef, 'whoop:ecfc6a15-4661-442f-a9a4-f160dd7afae8');
  assert.equal(a.sport, 'bike');
  assert.equal(a.durationSeconds, 22 * 60);
  assert.equal(a.elapsedSeconds, 22 * 60);
  assert.equal(a.distanceMeters, 7400);
  assert.equal(a.avgHr, 128);
  assert.equal(a.elevationGainMeters, 35);
  assert.equal(a.name, 'Cycling (Whoop)');
});

test('blips, unscorable and broken records are not sessions', () => {
  assert.equal(normalizeWhoopWorkout(w({ end: '2026-10-16T12:13:00Z' })), null, '3 minutes');
  assert.equal(normalizeWhoopWorkout(w({ score_state: 'UNSCORABLE' })), null);
  assert.equal(normalizeWhoopWorkout(w({ end: 'not a date' })), null);
});

test('a pending score still lands (HR fills in on the next sync)', () => {
  const a = normalizeWhoopWorkout(w({ score_state: 'PENDING_SCORE', score: null }))!;
  assert.equal(a.avgHr, null);
  assert.equal(a.distanceMeters, null);
  assert.equal(a.avgPaceSecPerKm, null);
});
