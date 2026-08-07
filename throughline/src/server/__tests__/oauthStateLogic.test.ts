import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueState, verifyState, signState } from '../oauthStateLogic';

const SECRET = 'test-secret-abc';
const ATH = '10000000-0000-4000-8000-000000000001';

test('issue → verify round-trips the athleteId', () => {
  const { state, cookieValue } = issueState(SECRET, ATH);
  assert.equal(verifyState(SECRET, state, cookieValue), ATH);
});

test('a fresh issue mints a new random nonce each time', () => {
  const a = issueState(SECRET, ATH);
  const b = issueState(SECRET, ATH);
  assert.notEqual(a.state, b.state);
});

test('mismatched state param (attacker guesses/forges the URL) is rejected', () => {
  const { cookieValue } = issueState(SECRET, ATH);
  assert.equal(verifyState(SECRET, 'not-the-nonce', cookieValue), null);
});

test('missing cookie (no connect-time cookie) is rejected — the CSRF guarantee', () => {
  const { state } = issueState(SECRET, ATH);
  assert.equal(verifyState(SECRET, state, undefined), null);
});

test('tampering the athleteId in the cookie breaks the signature', () => {
  const { state, cookieValue } = issueState(SECRET, ATH);
  const [nonce, , sig] = cookieValue.split(':');
  const forged = `${nonce}:11111111-1111-4111-8111-111111111111:${sig}`;
  assert.equal(verifyState(SECRET, state, forged), null);
});

test('a cookie signed with a different secret does not verify', () => {
  const { state, cookieValue } = issueState('other-secret', ATH);
  assert.equal(verifyState(SECRET, state, cookieValue), null);
});

test('malformed cookie shapes are rejected, not crashed', () => {
  assert.equal(verifyState(SECRET, 'x', 'only-one-part'), null);
  assert.equal(verifyState(SECRET, 'x', 'too:many:parts:here'), null);
  assert.equal(verifyState(SECRET, '', ''), null);
});

test('signState is deterministic for the same inputs', () => {
  assert.equal(signState(SECRET, 'n', ATH), signState(SECRET, 'n', ATH));
  assert.notEqual(signState(SECRET, 'n', ATH), signState(SECRET, 'n2', ATH));
});
