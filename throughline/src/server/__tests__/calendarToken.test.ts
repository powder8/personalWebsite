import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarToken, verifyCalendarToken } from '../calendarToken';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

test('a feed token works only for its own athlete', () => {
  process.env.AUTH_SECRET = 'test-secret';
  const t = calendarToken(A)!;
  assert.equal(t.length, 32);
  assert.equal(calendarToken(A), t, 'stable, so a subscription keeps working');
  assert.equal(verifyCalendarToken(A, t), true);
  assert.equal(verifyCalendarToken(B, t), false, "can't read another athlete's plan");
  assert.equal(verifyCalendarToken(A, t.slice(0, -1) + (t.endsWith('a') ? 'b' : 'a')), false);
  assert.equal(verifyCalendarToken(A, null), false);
});

test('rotating the secret revokes every link; no secret → no tokens', () => {
  process.env.AUTH_SECRET = 'test-secret';
  const t = calendarToken(A)!;
  process.env.AUTH_SECRET = 'rotated';
  assert.equal(verifyCalendarToken(A, t), false);
  delete process.env.AUTH_SECRET;
  assert.equal(calendarToken(A), null);
  assert.equal(verifyCalendarToken(A, 'x'.repeat(32)), false);
});

import { todayForTimezone, todayISO } from '@/lib/today';

test("an athlete's today follows their own timezone; unset falls back to the app's", () => {
  const prev = process.env.APP_TODAY;
  delete process.env.APP_TODAY;
  const fmt = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  assert.equal(todayForTimezone('America/Los_Angeles'), fmt('America/Los_Angeles'));
  assert.equal(todayForTimezone('Asia/Tokyo'), fmt('Asia/Tokyo'));
  assert.equal(todayForTimezone('UTC'), todayISO(), 'UTC is the never-captured default');
  assert.equal(todayForTimezone(null), todayISO());
  assert.equal(todayForTimezone('Not/AZone'), todayISO(), 'bad names never throw');
  process.env.APP_TODAY = '2026-01-02';
  assert.equal(todayForTimezone('Asia/Tokyo'), '2026-01-02', 'the demo pin still wins');
  if (prev == null) delete process.env.APP_TODAY; else process.env.APP_TODAY = prev;
});
