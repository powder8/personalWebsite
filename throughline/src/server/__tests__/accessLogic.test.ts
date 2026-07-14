import { test } from 'node:test';
import assert from 'node:assert/strict';
import { athleteVisibleTo, type ConsoleViewer } from '../accessLogic';

const admin: ConsoleViewer = { kind: 'admin' };
const coachA: ConsoleViewer = { kind: 'coach', userId: 'user_a' };
const coachB: ConsoleViewer = { kind: 'coach', userId: 'user_b' };

test('admin sees every athlete regardless of assignment', () => {
  assert.equal(athleteVisibleTo(admin, 'user_a'), true);
  assert.equal(athleteVisibleTo(admin, null), true);
  assert.equal(athleteVisibleTo(admin, 'user_b'), true);
});

test('a coach sees athletes assigned to them', () => {
  assert.equal(athleteVisibleTo(coachA, 'user_a'), true);
});

test('a coach does NOT see another coach\'s athletes', () => {
  assert.equal(athleteVisibleTo(coachA, 'user_b'), false);
  assert.equal(athleteVisibleTo(coachB, 'user_a'), false);
});

test('unassigned athletes are visible to any coach (until an admin assigns one)', () => {
  assert.equal(athleteVisibleTo(coachA, null), true);
  assert.equal(athleteVisibleTo(coachB, null), true);
});
