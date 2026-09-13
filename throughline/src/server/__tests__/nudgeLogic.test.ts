import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideNudge, type NudgeInput } from '../nudgeLogic';

const base: NudgeInput = {
  firstName: 'Sam',
  localHour: 8,
  todaySession: { sessionType: 'easy', discipline: 'run', volumeLabel: '5.0 mi', hasWork: true, isQuality: false, label: 'easy run' },
  loggedToday: false,
  streakDays: 0,
  layoffDays: 1,
  goalName: 'CIM Marathon',
  daysToGoal: 49,
};

test('morning + planned session → workout_today reminder', () => {
  const n = decideNudge(base)!;
  assert.equal(n.kind, 'workout_today');
  assert.match(n.subject, /Sam/);
  assert.match(n.body, /easy run/);
});

test('quality day reads as a quality nudge', () => {
  const n = decideNudge({ ...base, todaySession: { sessionType: 'threshold', discipline: 'run', volumeLabel: '6.0 mi', hasWork: true, isQuality: true, label: 'threshold session' } })!;
  assert.equal(n.kind, 'workout_today');
  assert.match(n.subject, /Quality day/);
  assert.match(n.body, /moves your race time/);
});

test('already logged today → no nudge (stay quiet)', () => {
  assert.equal(decideNudge({ ...base, loggedToday: true }), null);
});

test('rest day in the morning → no nudge', () => {
  assert.equal(decideNudge({ ...base, todaySession: { sessionType: 'rest', discipline: 'run', volumeLabel: '0.0 mi', hasWork: false, isQuality: false, label: 'rest' } }), null);
  assert.equal(decideNudge({ ...base, todaySession: null }), null);
});

test('evening + streak ≥3 + unrun session → streak protection', () => {
  const n = decideNudge({ ...base, localHour: 18, streakDays: 5 })!;
  assert.equal(n.kind, 'streak_protect');
  assert.match(n.subject, /5-day streak/);
  assert.match(n.body, /nothing to make up/i);
});

test('evening but no streak → nothing (do not nag)', () => {
  assert.equal(decideNudge({ ...base, localHour: 18, streakDays: 1 }), null);
});

test('morning + genuine layoff → comeback takes priority', () => {
  const n = decideNudge({ ...base, layoffDays: 9 })!;
  assert.equal(n.kind, 'comeback');
  assert.match(n.body, /no guilt/i);
  assert.doesNotMatch(n.body, /make up/i);
});

test('outside both windows → nothing', () => {
  assert.equal(decideNudge({ ...base, localHour: 14 }), null);
  assert.equal(decideNudge({ ...base, localHour: 2 }), null);
});

test('goal tail only when a goal is set', () => {
  const withGoal = decideNudge(base)!;
  assert.match(withGoal.body, /49 days to CIM Marathon/);
  const noGoal = decideNudge({ ...base, goalName: null, daysToGoal: null })!;
  assert.doesNotMatch(noGoal.body, /days to/);
});

test('never instructs making up miles, any branch', () => {
  for (const hour of [8, 18]) {
    for (const layoff of [1, 6, 20]) {
      for (const streak of [0, 5]) {
        const n = decideNudge({ ...base, localHour: hour, layoffDays: layoff, streakDays: streak });
        if (n) assert.doesNotMatch(n.body, /make up the (miles|mileage|runs)/i);
      }
    }
  }
});

// --- multisport: a ride is a session, in minutes, and never "0 mi" ---
test('a planned RIDE gets a ride nudge in MINUTES (it is not a rest day because miles are 0)', () => {
  const n = decideNudge({
    ...base,
    todaySession: { sessionType: 'easy', discipline: 'bike', volumeLabel: '45 min', hasWork: true, isQuality: false, label: 'easy ride' },
  })!;
  assert.ok(n, 'a 45-min ride is a real session');
  assert.equal(n.kind, 'workout_today');
  assert.match(n.subject, /Today's ride/);
  assert.match(n.body, /easy ride, 45 min/);
  assert.doesNotMatch(n.body, /\bmi\b|Today's run/, 'never rendered as a run or in miles');
});

test('comeback copy talks about training, not just running', () => {
  const n = decideNudge({ ...base, layoffDays: 6, todaySession: null })!;
  assert.equal(n.kind, 'comeback');
  assert.match(n.body, /since you last trained/);
  assert.doesNotMatch(n.body, /last run|first run back/);
});
