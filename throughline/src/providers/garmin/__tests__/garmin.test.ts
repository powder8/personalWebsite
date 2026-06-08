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
  assert.equal(a.sourceRef, 'abc-123');
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
