import { test } from 'node:test';
import assert from 'node:assert/strict';
import { athleteVisibleTo, decideAthleteWriteAccess, type ConsoleViewer } from '../accessLogic';

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

// ── write guard (decideAthleteWriteAccess) ──────────────────────────────────
const ATH = 'athlete_1';
const coachUser = { role: 'coach', id: 'user_a' };
const adminUser = { role: 'admin', id: 'user_x' };
const athleteUser = { role: 'athlete', athleteId: ATH };

test('unconfigured (local/staged) allows everyone — no lockout before auth is live', () => {
  assert.equal(decideAthleteWriteAccess({ configured: false, user: null, athleteId: ATH, coachVisible: false }), 'allow');
});

test('signed-out is forbidden once auth is configured', () => {
  assert.equal(decideAthleteWriteAccess({ configured: true, user: null, athleteId: ATH, coachVisible: false }), 'forbid');
});

test('admin may write to any athlete', () => {
  assert.equal(decideAthleteWriteAccess({ configured: true, user: adminUser, athleteId: ATH, coachVisible: false }), 'allow');
});

test('an athlete may write to their OWN id but not another', () => {
  assert.equal(decideAthleteWriteAccess({ configured: true, user: athleteUser, athleteId: ATH, coachVisible: false }), 'allow');
  assert.equal(
    decideAthleteWriteAccess({ configured: true, user: athleteUser, athleteId: 'athlete_2', coachVisible: false }),
    'forbid',
  );
});

test('a coach may write only to a visible (assigned/unassigned) athlete', () => {
  assert.equal(decideAthleteWriteAccess({ configured: true, user: coachUser, athleteId: ATH, coachVisible: true }), 'allow');
});

test('a coach is FORBIDDEN from another coach\'s athlete — the gap this guard closes', () => {
  assert.equal(decideAthleteWriteAccess({ configured: true, user: coachUser, athleteId: ATH, coachVisible: false }), 'forbid');
});
