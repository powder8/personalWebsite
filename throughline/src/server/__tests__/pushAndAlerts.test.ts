import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidSubscription, pushConfigured } from '../push';
import { alertContent } from '../healthAlerts';
import { applyBodyToReadiness } from '../healthRefresh';
import type { BodyStatusView } from '../bodyStatus';

test('only well-formed https push subscriptions are accepted', () => {
  const ok = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'k'.repeat(87), auth: 'a'.repeat(22) } };
  assert.equal(isValidSubscription(ok), true);
  assert.equal(isValidSubscription({ ...ok, endpoint: 'http://insecure.example/x' }), false);
  assert.equal(isValidSubscription({ ...ok, endpoint: 'not a url' }), false);
  assert.equal(isValidSubscription({ endpoint: ok.endpoint }), false);
  assert.equal(isValidSubscription({ ...ok, keys: { p256dh: 'k'.repeat(5000), auth: 'a' } }), false);
  assert.equal(isValidSubscription(null), false);
});

test('without VAPID keys, push is off (sends are a no-op, not an error)', () => {
  const saved = { a: process.env.VAPID_PUBLIC_KEY, b: process.env.VAPID_PRIVATE_KEY };
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  assert.equal(pushConfigured(), false);
  if (saved.a) process.env.VAPID_PUBLIC_KEY = saved.a;
  if (saved.b) process.env.VAPID_PRIVATE_KEY = saved.b;
});

const view = (o: Partial<BodyStatusView>): BodyStatusView => ({
  status: 'illness_suspected', tone: 'alert', headline: 'Your body may be fighting something',
  body: 'Your signals have been outside your normal range for 3 days.', planNote: 'Sessions are easy at about 60% volume.',
  question: 'Are you feeling ill?', asks: [], advice: [], forceEasy: true, evidence: [], dataDay: '2026-11-10', stale: false,
  vitals: [], load: { ratio: null, note: null }, episode: null, history: [], strain: [], progressionActive: false, planChanged: true, ...o,
});

test('the alert says what we saw, what changed, and what we need from the athlete', () => {
  const { title, body } = alertContent(view({}));
  assert.equal(title, 'Your body may be fighting something');
  assert.match(body, /outside your normal range/);
  assert.match(body, /60% volume/);
  assert.match(body, /Are you feeling ill\? Open the app to answer\./);
});

test('an open episode overrides a good day score: readiness cannot say "go"', () => {
  const good = { day: '2026-11-10', score: 82, band: 'go' as const, sentence: 'Green light for quality.', drivers: [], sufficientData: true };
  const merged = applyBodyToReadiness(good, view({}), '2026-11-10')!;
  assert.equal(merged.band, 'easy');
  assert.ok(merged.score <= 35);
  assert.match(merged.sentence, /fighting something/);
  // No episode → untouched.
  assert.equal(applyBodyToReadiness(good, view({ forceEasy: false }), '2026-11-10'), good);
  // No day score at all (no check-in, stale wearable) still yields an easy call.
  assert.equal(applyBodyToReadiness(null, view({}), '2026-11-10')!.band, 'easy');
});
