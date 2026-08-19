import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStravaRouteId } from '@/lib/stravaRoute';

test('extracts the id from a Strava route URL (www + bare + query/hash)', () => {
  assert.equal(parseStravaRouteId('https://www.strava.com/routes/3306512345'), '3306512345');
  assert.equal(parseStravaRouteId('https://strava.com/routes/3306512345'), '3306512345');
  assert.equal(parseStravaRouteId('https://www.strava.com/routes/3306512345?foo=bar'), '3306512345');
  assert.equal(parseStravaRouteId('https://www.strava.com/routes/3306512345/edit'), '3306512345');
  assert.equal(parseStravaRouteId('  3306512345  '), '3306512345'); // bare id
});

test('rejects non-Strava hosts and non-route paths (SSRF guard)', () => {
  assert.equal(parseStravaRouteId('https://evil.com/routes/123456'), null);
  assert.equal(parseStravaRouteId('https://strava.com.evil.com/routes/123456'), null);
  assert.equal(parseStravaRouteId('https://www.strava.com/activities/123456'), null);
  assert.equal(parseStravaRouteId('https://www.strava.com/athletes/123456'), null);
  assert.equal(parseStravaRouteId('http://169.254.169.254/latest/meta-data'), null);
  assert.equal(parseStravaRouteId('file:///etc/passwd'), null);
  assert.equal(parseStravaRouteId('not a url'), null);
  assert.equal(parseStravaRouteId(''), null);
});
