import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicErrorMessage } from '../publicError';

const quiet = <T>(fn: () => T): T => {
  const orig = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = orig; }
};

test('our own user-facing messages pass through', () => {
  assert.equal(publicErrorMessage(new Error('Enter your FTP in watts (a number up to 600).'), 'Failed.'), 'Enter your FTP in watts (a number up to 600).');
  assert.equal(publicErrorMessage(new Error('Connect your Strava account first.'), 'Failed.'), 'Connect your Strava account first.');
});

test('internal details become the generic fallback', () => {
  quiet(() => {
    assert.equal(publicErrorMessage(new Error('Failed query: select "id" from "athletes" where ...'), 'Failed.'), 'Failed.');
    assert.equal(publicErrorMessage(Object.assign(new Error('duplicate key value violates unique constraint "x"'), { code: '23505' }), 'Failed.'), 'Failed.');
    assert.equal(publicErrorMessage(new Error('Strava activities fetch failed (HTTP 500).'), 'Sync failed.'), 'Sync failed.');
    assert.equal(publicErrorMessage(new TypeError("Cannot read properties of undefined (reading 'id')"), 'Failed.'), 'Failed.');
    assert.equal(publicErrorMessage(new Error('TOKEN_ENCRYPTION_KEY is not configured.'), 'Failed.'), 'Failed.');
    assert.equal(publicErrorMessage('a string', 'Failed.'), 'Failed.');
    assert.equal(publicErrorMessage(new Error('x'.repeat(300)), 'Failed.'), 'Failed.');
  });
});
