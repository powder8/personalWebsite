import { test } from 'node:test';
import assert from 'node:assert/strict';

import { garmin } from '../index';

test('normalizes a Garmin daily into a summary AND a resting-HR record', () => {
  const batch = garmin.normalize('dailies', {
    calendarDate: '2026-06-01',
    steps: 9123,
    restingHeartRateInBeatsPerMinute: 48,
    averageStressLevel: 27,
    bodyBatteryLowestValue: 12,
    bodyBatteryHighestValue: 88,
  });
  assert.equal(batch.dailySummaries?.length, 1);
  assert.equal(batch.dailySummaries![0].day, '2026-06-01');
  assert.equal(batch.dailySummaries![0].restingHr, 48);
  assert.equal(batch.dailySummaries![0].bodyBatteryHigh, 88);
  // resting HR also surfaced separately so it feeds readiness/baselines.
  assert.equal(batch.restingHrRecords?.length, 1);
  assert.equal(batch.restingHrRecords![0].restingHr, 48);
  assert.equal(batch.restingHrRecords![0].day, '2026-06-01');
});

test('omits resting-HR record when the daily has none', () => {
  const batch = garmin.normalize('dailies', { calendarDate: '2026-06-02', steps: 100 });
  assert.equal(batch.dailySummaries?.length, 1);
  assert.equal(batch.restingHrRecords, undefined);
});

test('normalizes a Garmin sleep into stage durations', () => {
  const batch = garmin.normalize('sleeps', {
    calendarDate: '2026-06-01',
    durationInSeconds: 27000, // 7.5h
    deepSleepDurationInSeconds: 6000,
    remSleepInSeconds: 5400,
    lightSleepDurationInSeconds: 14400,
    awakeDurationInSeconds: 1200,
  });
  assert.equal(batch.sleepRecords?.length, 1);
  const s = batch.sleepRecords![0];
  assert.equal(s.day, '2026-06-01');
  assert.equal(s.totalSleepSeconds, 27000);
  assert.equal(s.deepSeconds, 6000);
  assert.equal(s.remSeconds, 5400);
});

test('normalizes a Garmin HRV summary into overnight average (ms)', () => {
  const batch = garmin.normalize('hrv', { calendarDate: '2026-06-01', lastNightAvg: 62 });
  assert.equal(batch.hrvRecords?.length, 1);
  assert.equal(batch.hrvRecords![0].day, '2026-06-01');
  assert.equal(batch.hrvRecords![0].overnightAvgMs, 62);
});

test('normalizes a Garmin running activity (pace from speed, sourceRef)', () => {
  const batch = garmin.normalize('activities', {
    activityType: 'RUNNING',
    startTimeInSeconds: 1780000000,
    durationInSeconds: 1800,
    distanceInMeters: 5000,
    averageHeartRateInBeatsPerMinute: 150,
    averageSpeedInMetersPerSecond: 2.7777778, // ~360 s/km
    summaryId: 'abc-123',
  });
  assert.equal(batch.activities?.length, 1);
  const a = batch.activities![0];
  assert.equal(a.sport, 'run');
  assert.equal(a.distanceMeters, 5000);
  assert.ok(a.avgPaceSecPerKm != null && Math.abs(a.avgPaceSecPerKm - 360) < 1);
  assert.equal(a.sourceRef, 'garmin:abc-123');
});

test('parseWebhook splits a batched body into per-record events', () => {
  const items = garmin.parseWebhook(
    JSON.stringify({
      dailies: [{ userId: 'u1', calendarDate: '2026-06-01' }],
      sleeps: [{ userId: 'u1', calendarDate: '2026-06-01' }],
    }),
  );
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((i) => i.eventType).sort(),
    ['dailies', 'sleeps'],
  );
  assert.equal(items[0].providerUserId, 'u1');
});

test('userMetrics carries per-sport VO2max (running and cycling differ)', () => {
  const batch = garmin.normalize('userMetrics', {
    calendarDate: '2026-09-05',
    vo2Max: 52.4,
    vo2MaxCycling: 48.1,
  });
  const d = batch.dailySummaries![0];
  assert.equal(d.day, '2026-09-05');
  assert.equal(d.vo2maxRunning, 52.4);
  assert.equal(d.vo2maxCycling, 48.1, 'cycling VO2max is tracked separately, not assumed equal');
});

test('userMetrics with no VO2max stores nothing', () => {
  assert.deepEqual(garmin.normalize('userMetrics', { calendarDate: '2026-09-05' }), {});
});

test('a running-only VO2max leaves cycling null rather than copying it across', () => {
  const d = garmin.normalize('userMetrics', { calendarDate: '2026-09-06', vo2Max: 51 }).dailySummaries![0];
  assert.equal(d.vo2maxRunning, 51);
  assert.equal(d.vo2maxCycling, null);
});

test('bodyComps (a Withings scale via Garmin) → weight, body fat and BMI on the measured day', () => {
  const d = garmin.normalize('bodyComps', {
    calendarDate: '2026-09-18',
    measurementTimeInSeconds: 1789700000,
    weightInGrams: 74350,
    bodyFatInPercent: 14.2,
    bodyMassIndex: 22.9,
  }).dailySummaries![0];
  assert.equal(d.day, '2026-09-18');
  assert.equal(d.weightKg, 74.35, 'grams → kg, two decimals');
  assert.equal(d.bodyFatPct, 14.2);
  assert.equal(d.bmi, 22.9);
});

test('a bodyComps summary with no measurements stores nothing', () => {
  assert.deepEqual(garmin.normalize('bodyComps', { calendarDate: '2026-09-18' }), {});
});

// ---- OAuth2 PKCE + webhook auth ---------------------------------------------

import { createHash } from 'node:crypto';
import { pkceChallenge, pkceVerifier } from '../index';

test('PKCE: verifier is valid (43+ url-safe chars), stable per state, unique across states', () => {
  const v = pkceVerifier('state-1', 'secret');
  assert.match(v, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(pkceVerifier('state-1', 'secret'), v);
  assert.notEqual(pkceVerifier('state-2', 'secret'), v);
  assert.notEqual(pkceVerifier('state-1', 'other-secret'), v, 'unguessable without the secret');
  assert.equal(pkceChallenge(v), createHash('sha256').update(v).digest('base64url'), 'S256 per RFC 7636');
});

test('authorization URL follows Garmin spec: oauth2Confirm, S256 challenge, state, redirect', () => {
  process.env.GARMIN_CLIENT_ID = 'cid';
  process.env.GARMIN_REDIRECT_URI = 'https://example.test/api/auth/garmin/callback';
  process.env.AUTH_SECRET = 'secret';
  const u = new URL(garmin.getAuthorizationUrl('st'));
  assert.equal(`${u.origin}${u.pathname}`, 'https://connect.garmin.com/oauth2Confirm');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('client_id'), 'cid');
  assert.equal(u.searchParams.get('state'), 'st');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('code_challenge'), pkceChallenge(pkceVerifier('st', 'secret')));
  assert.equal(u.searchParams.get('redirect_uri'), 'https://example.test/api/auth/garmin/callback');
});

test('webhook auth: the URL key must match; no configured secret fails closed', async () => {
  process.env.GARMIN_WEBHOOK_SECRET = 'hook-secret';
  const req = (q: string) => new Request(`https://example.test/api/webhooks/garmin${q}`, { method: 'POST' });
  assert.equal(await garmin.verifyWebhook(req('?key=hook-secret'), ''), true);
  assert.equal(await garmin.verifyWebhook(req('?key=wrong'), ''), false);
  assert.equal(await garmin.verifyWebhook(req(''), ''), false);
  delete process.env.GARMIN_WEBHOOK_SECRET;
  assert.equal(await garmin.verifyWebhook(req('?key=anything'), ''), false);
});

test('ping notifications and deregistrations parse with their user id', () => {
  const items = garmin.parseWebhook(JSON.stringify({
    dailies: [{ userId: 'u1', callbackURL: 'https://apis.garmin.com/wellness-api/rest/dailies?uploadStartTimeInSeconds=1&uploadEndTimeInSeconds=2' }],
    deregistrations: [{ userId: 'u2' }],
  }));
  assert.deepEqual(items.map((i) => [i.eventType, i.providerUserId]), [['dailies', 'u1'], ['deregistrations', 'u2']]);
  assert.equal((items[0].payload as { callbackURL: string }).callbackURL.startsWith('https://apis.garmin.com/'), true);
});

test('Garmin activity types map to the right sport', () => {
  const sport = (t: string) => garmin.normalize('activities', { activityType: t, startTimeInSeconds: 0, durationInSeconds: 1800, summaryId: t }).activities![0].sport;
  assert.equal(sport('VIRTUAL_RIDE'), 'bike');
  assert.equal(sport('INDOOR_CYCLING'), 'bike');
  assert.equal(sport('TRAIL_RUNNING'), 'run');
  assert.equal(sport('OPEN_WATER_SWIMMING'), 'swim');
  assert.equal(sport('STRENGTH_TRAINING'), 'strength');
  assert.equal(sport('HIKING'), 'cross_train');
  assert.equal(sport('YOGA'), 'other');
});
