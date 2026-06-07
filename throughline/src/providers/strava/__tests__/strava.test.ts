import { test } from 'node:test';
import assert from 'node:assert/strict';

import { strava, normalizeActivity, mapSport, type StravaActivity } from '../index';

test('mapSport maps Strava sport_type values to our enum', () => {
  assert.equal(mapSport('Run'), 'run');
  assert.equal(mapSport('TrailRun'), 'run');
  assert.equal(mapSport('VirtualRun'), 'run');
  assert.equal(mapSport('Ride'), 'bike');
  assert.equal(mapSport('GravelRide'), 'bike');
  assert.equal(mapSport('Swim'), 'swim');
  assert.equal(mapSport('Walk'), 'other');
  assert.equal(mapSport(undefined), 'other');
});

test('normalizeActivity derives pace from speed and doubles run cadence', () => {
  const a: StravaActivity = {
    id: 123456789,
    name: 'Morning Run',
    sport_type: 'Run',
    start_date: '2026-05-01T13:00:00Z',
    moving_time: 1800,
    elapsed_time: 1850,
    distance: 5000, // 5 km
    average_heartrate: 152.4,
    max_heartrate: 171.9,
    average_speed: 2.7777778, // 10 km/h → 360 s/km (6:00/mi-ish)
    average_cadence: 85, // per-leg → 170 steps/min
  };
  const row = normalizeActivity(a);
  assert.equal(row.sport, 'run');
  assert.equal(row.distanceMeters, 5000);
  assert.equal(row.durationSeconds, 1800); // prefers moving_time
  assert.equal(row.avgHr, 152);
  assert.equal(row.maxHr, 172);
  assert.ok(row.avgPaceSecPerKm != null && Math.abs(row.avgPaceSecPerKm - 360) < 1);
  assert.equal(row.cadence, 170);
  assert.equal(row.sourceRef, 'strava:123456789');
  assert.ok(row.startTime instanceof Date);
  assert.equal(row.startTime.toISOString(), '2026-05-01T13:00:00.000Z');
});

test('normalizeActivity keeps bike cadence unscaled and tolerates missing fields', () => {
  const row = normalizeActivity({ id: 'x1', sport_type: 'Ride', average_cadence: 90 });
  assert.equal(row.sport, 'bike');
  assert.equal(row.cadence, 90);
  assert.equal(row.distanceMeters, null);
  assert.equal(row.avgPaceSecPerKm, null);
  assert.equal(row.sourceRef, 'strava:x1');
});

test('getAuthorizationUrl includes client id, scope and state', () => {
  process.env.STRAVA_CLIENT_ID = 'test-client';
  process.env.STRAVA_REDIRECT_URI = 'https://example.test/api/auth/strava/callback';
  const url = strava.getAuthorizationUrl('athlete-42');
  assert.match(url, /^https:\/\/www\.strava\.com\/oauth\/authorize\?/);
  assert.match(url, /client_id=test-client/);
  assert.match(url, /scope=read%2Cactivity%3Aread_all/);
  assert.match(url, /state=athlete-42/);
  assert.match(url, /redirect_uri=https%3A%2F%2Fexample\.test/);
});

test('parseWebhook surfaces only activity events with the owner id', () => {
  const create = strava.parseWebhook(
    JSON.stringify({ object_type: 'activity', object_id: 99, aspect_type: 'create', owner_id: 7 }),
  );
  assert.equal(create.length, 1);
  assert.equal(create[0].eventType, 'activity_event');
  assert.equal(create[0].providerUserId, '7');

  const athleteEvent = strava.parseWebhook(
    JSON.stringify({ object_type: 'athlete', object_id: 7, aspect_type: 'update', owner_id: 7 }),
  );
  assert.equal(athleteEvent.length, 0);
});
