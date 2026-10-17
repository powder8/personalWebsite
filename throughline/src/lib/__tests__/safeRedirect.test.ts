import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeCallbackPath } from '../safeRedirect';

const HOST = 'throughline.badoo.net';

test('same-site paths pass through', () => {
  assert.equal(safeCallbackPath('/me/abc?tab=progress', HOST), '/me/abc?tab=progress');
  assert.equal(safeCallbackPath(`https://${HOST}/me/abc#x`, HOST), '/me/abc#x', 'Auth.js sends the full URL');
});

test('other sites and tricks are dropped (no open redirect)', () => {
  assert.equal(safeCallbackPath('https://evil.example/phish', HOST), undefined);
  assert.equal(safeCallbackPath('//evil.example/phish', HOST), undefined);
  assert.equal(safeCallbackPath('/\\evil.example', HOST), undefined);
  assert.equal(safeCallbackPath('javascript:alert(1)', HOST), undefined);
  assert.equal(safeCallbackPath(`https://${HOST}.evil.example/`, HOST), undefined);
  assert.equal(safeCallbackPath(undefined, HOST), undefined);
  assert.equal(safeCallbackPath(`https://${HOST}/me`, null), undefined, 'no host → no absolute URLs');
});
