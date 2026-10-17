import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSealed, openToken, sealToken } from '../tokenCrypto';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

test('round trip; ciphertext never contains the token; each seal is unique', () => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY_A;
  const s1 = sealToken('strava-access-123')!;
  const s2 = sealToken('strava-access-123')!;
  assert.ok(isSealed(s1));
  assert.ok(!s1.includes('strava-access-123'));
  assert.notEqual(s1, s2, 'random IV per value');
  assert.equal(openToken(s1), 'strava-access-123');
  assert.equal(openToken(s2), 'strava-access-123');
});

test('legacy plaintext reads as-is; null stays null; sealing is idempotent', () => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY_A;
  assert.equal(openToken('old-plaintext-token'), 'old-plaintext-token');
  assert.equal(sealToken(null), null);
  assert.equal(openToken(null), null);
  const s = sealToken('x')!;
  assert.equal(sealToken(s), s);
});

test('a wrong key or a tampered value fails loudly instead of returning garbage', () => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY_A;
  const s = sealToken('secret')!;
  process.env.TOKEN_ENCRYPTION_KEY = KEY_B;
  assert.throws(() => openToken(s));
  process.env.TOKEN_ENCRYPTION_KEY = KEY_A;
  const flipped = s.slice(0, -2) + (s.endsWith('A') ? 'B' : 'A') + s.slice(-1);
  assert.throws(() => openToken(flipped));
});

test('a deployed build with no key refuses to seal', () => {
  const saved = { k: process.env.TOKEN_ENCRYPTION_KEY, a: process.env.AUTH_SECRET, v: process.env.VERCEL };
  delete process.env.TOKEN_ENCRYPTION_KEY;
  delete process.env.AUTH_SECRET;
  process.env.VERCEL = '1';
  assert.throws(() => sealToken('t'), /TOKEN_ENCRYPTION_KEY/);
  delete process.env.VERCEL;
  assert.ok(isSealed(sealToken('t')), 'local dev falls back to a dev key');
  Object.assign(process.env, { TOKEN_ENCRYPTION_KEY: saved.k ?? KEY_A });
  if (saved.a) process.env.AUTH_SECRET = saved.a;
  if (saved.v) process.env.VERCEL = saved.v;
});
