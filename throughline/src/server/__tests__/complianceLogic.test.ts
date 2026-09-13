import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateWeek, judgeSession, type PlannedRef, type ActualRef } from '../complianceLogic';

const WEEK = { weekStart: '2026-09-07', weekEnd: '2026-09-13', phase: 'Base' };
const MI = 1609.344;
const run = (day: string, miles: number, type = 'easy'): PlannedRef =>
  ({ day, discipline: 'run', sessionType: type, targetMeters: miles * MI, targetSeconds: 0 });
const ride = (day: string, minutes: number, type = 'easy'): PlannedRef =>
  ({ day, discipline: 'bike', sessionType: type, targetMeters: 0, targetSeconds: minutes * 60 });
const rest = (day: string, discipline: PlannedRef['discipline']): PlannedRef =>
  ({ day, discipline, sessionType: 'rest', targetMeters: 0, targetSeconds: 0 });
const did = (day: string, sport: string, o: { miles?: number; minutes?: number }): ActualRef =>
  ({ day, sport, meters: (o.miles ?? 0) * MI, seconds: (o.minutes ?? 0) * 60 });

test('a planned RIDE is satisfied by a ride, judged in MINUTES', () => {
  const w = evaluateWeek({ ...WEEK, today: '2026-09-13', planned: [ride('2026-09-08', 60)], actuals: [did('2026-09-08', 'bike', { minutes: 55, miles: 18 })] });
  const d = w.days.find((x) => x.day === '2026-09-08')!;
  assert.equal(d.status, 'done', '55 of 60 min is done (≥80%)');
  assert.equal(d.crossTrainSessions, 0, 'the planned ride is the session, not cross-training');
  assert.equal(w.sessionsPlanned, 1);
  assert.equal(w.sessionsDone, 1);
  assert.equal(w.adherencePct, 100);
});

test('THE OLD BUG: a planned ride is not "missed" just because you did not run', () => {
  // Old model measured the ride in miles → 0 planned → "done only if run miles > 0".
  const w = evaluateWeek({ ...WEEK, today: '2026-09-13', planned: [ride('2026-09-08', 60)], actuals: [did('2026-09-08', 'bike', { minutes: 60 })] });
  assert.equal(w.days.find((x) => x.day === '2026-09-08')!.status, 'done');
});

test('a ride never satisfies a planned RUN', () => {
  const w = evaluateWeek({ ...WEEK, today: '2026-09-13', planned: [run('2026-09-08', 5)], actuals: [did('2026-09-08', 'bike', { minutes: 90, miles: 30 })] });
  const d = w.days.find((x) => x.day === '2026-09-08')!;
  assert.equal(d.status, 'missed');
  assert.equal(d.crossTrainSessions, 1, 'the ride is credited as cross-training');
  assert.equal(d.actualMiles, 0, 'run miles stay honest');
});

test('a tri day keeps BOTH sessions and judges each in its own unit', () => {
  // Old model: one session per day — the bike overwrote the run (or vice versa).
  const w = evaluateWeek({
    ...WEEK, today: '2026-09-13',
    planned: [ride('2026-09-09', 60), run('2026-09-09', 4)],
    actuals: [did('2026-09-09', 'bike', { minutes: 60 }), did('2026-09-09', 'run', { miles: 4 })],
  });
  const d = w.days.find((x) => x.day === '2026-09-09')!;
  assert.equal(d.sessions.length, 2, 'both planned sessions survive');
  assert.equal(d.status, 'done');
  assert.equal(w.sessionsPlanned, 2);
  assert.equal(w.sessionsDone, 2);
  assert.equal(d.sessionType, 'easy');
});

test('a brick with the ride done and the run skipped is PARTIAL, adherence 50%', () => {
  const w = evaluateWeek({
    ...WEEK, today: '2026-09-13',
    planned: [ride('2026-09-09', 60), run('2026-09-09', 4)],
    actuals: [did('2026-09-09', 'bike', { minutes: 60 })],
  });
  const d = w.days.find((x) => x.day === '2026-09-09')!;
  assert.equal(d.status, 'partial');
  assert.deepEqual(d.sessions.map((s) => `${s.discipline}:${s.status}`).sort(), ['bike:done', 'run:missed']);
  assert.equal(w.adherencePct, 50);
});

test('short sessions are partial; future days are upcoming; an off-plan session is extra', () => {
  const w = evaluateWeek({
    ...WEEK, today: '2026-09-10',
    planned: [run('2026-09-08', 5), run('2026-09-12', 8), rest('2026-09-09', 'run')],
    actuals: [did('2026-09-08', 'run', { miles: 2 }), did('2026-09-09', 'swim', { minutes: 30, miles: 1 })],
  });
  const by = Object.fromEntries(w.days.map((d) => [d.day, d.status]));
  assert.equal(by['2026-09-08'], 'partial', '2 of 5 mi');
  assert.equal(by['2026-09-12'], 'upcoming', 'not due yet, not counted');
  assert.equal(by['2026-09-09'], 'extra', 'a swim on a rest day is a bonus, not a miss');
  assert.equal(by['2026-09-10'], 'rest', 'nothing planned, nothing done');
  assert.equal(w.sessionsPlanned, 1, 'only the one due session counts');
});

test('a planned session with no volume prescribed is done by any session in that sport', () => {
  const p: PlannedRef = { day: '2026-09-08', discipline: 'strength', sessionType: 'strength', targetMeters: 0, targetSeconds: 0 };
  assert.equal(judgeSession(p, { meters: 0, seconds: 40 * 60 }, true).status, 'done');
  assert.equal(judgeSession(p, undefined, true).status, 'missed');
});

test('week totals: run miles stay run-only, cross-training is only the unplanned sports', () => {
  const w = evaluateWeek({
    ...WEEK, today: '2026-09-13',
    planned: [run('2026-09-08', 5), ride('2026-09-10', 60)],
    actuals: [
      did('2026-09-08', 'run', { miles: 5 }),
      did('2026-09-10', 'bike', { minutes: 60, miles: 20 }),
      did('2026-09-11', 'swim', { minutes: 30 }), // nothing planned → cross-training
    ],
  });
  assert.ok(Math.abs(w.plannedMiles - 5) < 1e-9 && Math.abs(w.actualMiles - 5) < 1e-9, 'the ride does not leak into run miles');
  assert.equal(w.crossTrainSessions, 1, 'only the swim is cross-training');
  assert.equal(w.crossTrainMinutes, 30);
  assert.equal(w.adherencePct, 100);
});
