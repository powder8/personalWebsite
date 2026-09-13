import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionDebrief, type SessionDebriefInput } from '../sessionDebriefLogic';

const ride = (over: Partial<SessionDebriefInput> = {}): SessionDebriefInput => ({
  sport: 'bike',
  distanceMeters: 39000,
  durationSeconds: 77 * 60,
  avgHr: 138,
  maxHr: 162,
  elevationGainMeters: 260,
  planned: { sessionType: 'endurance', durationSeconds: 75 * 60, distanceMeters: null },
  units: 'mi',
  ...over,
});

const keys = (d: ReturnType<typeof buildSessionDebrief>) => d.signals.map((s) => s.key);

test('a planned ride, done → positive showed_up, sized in SPEED not run pace', () => {
  const d = buildSessionDebrief(ride());
  assert.equal(d.headline, 'Solid ride');
  assert.equal(d.signals.find((s) => s.key === 'showed_up')!.polarity, 'positive');
  const size = d.signals.find((s) => s.key === 'duration')!.fact;
  assert.match(size, /mph/);
  assert.doesNotMatch(size, /\/mi/, 'cycling never reads as minutes per mile');
  assert.ok(keys(d).includes('climbing'), '260 m of climbing is worth noting');
  assert.match(d.focusNext, /Nothing to change/);
});

test('cut short → caution, and the advice depends on why', () => {
  const d = buildSessionDebrief(ride({ durationSeconds: 40 * 60 })); // 53% of 75 min
  assert.equal(d.headline, 'Cut the ride short');
  assert.equal(d.signals.find((s) => s.key === 'showed_up')!.polarity, 'caution');
  assert.match(d.focusNext, /protect the next planned ride/);
});

test('went long → caution about fatigue, not a scold', () => {
  const d = buildSessionDebrief(ride({ durationSeconds: 120 * 60 })); // 160%
  assert.equal(d.headline, 'Went long on the ride');
  assert.match(d.focusNext, /adds fatigue/);
});

test('an unplanned ride is a bonus, with a gentle "don\'t steal from key days"', () => {
  const d = buildSessionDebrief(ride({ planned: null }));
  assert.equal(d.headline, 'Bonus ride');
  assert.equal(d.signals.find((s) => s.key === 'showed_up')!.polarity, 'context');
  assert.match(d.focusNext, /key days/);
});

test('effort is only JUDGED against a threshold reference', () => {
  // No LTHR → report the HR, no verdict.
  const noRef = buildSessionDebrief(ride());
  const eff = noRef.signals.find((s) => s.key === 'effort')!;
  assert.equal(eff.polarity, 'context');
  assert.match(eff.fact, /Avg 138 bpm, peaked at 162/);
  assert.doesNotMatch(noRef.focusNext, /not easy/);

  // With LTHR, an easy day ridden at 92% of threshold IS too hard.
  const hard = buildSessionDebrief(ride({ avgHr: 150, lthrBpm: 163 }));
  assert.equal(hard.signals.find((s) => s.key === 'effort')!.polarity, 'caution');
  assert.match(hard.focusNext, /heart rate says it was not easy/);

  // Same threshold, genuinely easy → no verdict.
  const easy = buildSessionDebrief(ride({ avgHr: 125, lthrBpm: 163 }));
  assert.equal(easy.signals.find((s) => s.key === 'effort')!.polarity, 'context');
});

test('a swim is prescribed and sized by DISTANCE, in metres', () => {
  const d = buildSessionDebrief({
    sport: 'swim',
    distanceMeters: 1900,
    durationSeconds: 38 * 60,
    avgHr: null,
    maxHr: null,
    elevationGainMeters: null,
    planned: { sessionType: 'endurance', durationSeconds: null, distanceMeters: 2000 },
    units: 'mi',
  });
  assert.equal(d.headline, 'Solid swim');
  assert.match(d.signals.find((s) => s.key === 'duration')!.fact, /1,900 m/);
  assert.ok(!keys(d).includes('climbing'), 'no climbing signal for a swim');
});

test('strength is time-only and banked', () => {
  const d = buildSessionDebrief({
    sport: 'strength',
    distanceMeters: null,
    durationSeconds: 45 * 60,
    avgHr: 110,
    maxHr: null,
    elevationGainMeters: null,
    planned: { sessionType: 'strength', durationSeconds: 45 * 60, distanceMeters: null },
    units: 'km',
  });
  assert.equal(d.headline, 'Strength banked');
  assert.match(d.wentWell, /injury-free/);
});
