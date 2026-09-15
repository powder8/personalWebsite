import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentSignal, recoveryPattern } from '../recoveryLogic';
import { assessReadiness } from '@/engine';
import { addDays } from '@/engine/dates';
import { decideReadinessGate } from '../readinessGate';

const today = '2026-09-14';
const baseline = Array.from({ length: 20 }, (_, i) => ({ day: addDays(today, i - 19), value: 50 + i % 3 }));
const neutral = { day: today, hrvZ: null, restingHrZ: null, sleepZ: null, soreness: null, energy: null, yesterdayRpe: null };

test('stale, future and insufficient observations cannot provide current physiological guidance', () => {
  assert.equal(currentSignal(baseline.slice(0, -3), today).z, null);
  assert.equal(currentSignal([{ day: today, value: 50 }], today).z, null);
  assert.equal(currentSignal([...baseline, { day: '2026-12-01', value: 999 }], today).value, 51);
  assert.notEqual(currentSignal(baseline, today).z, null);
});

test('multiple wearable records count as one baseline day', () => {
  assert.equal(currentSignal([...baseline, ...baseline], today).n, 20);
});

test('strong fatigue is not cancelled by excellent wearable readings', () => {
  const r = assessReadiness({ ...neutral, hrvZ: 2, restingHrZ: -2, sleepZ: 2, soreness: 9, energy: 8 });
  assert.equal(r.band, 'easy');
});

test('life stress and poor sleep influence readiness without a wearable', () => {
  const r = assessReadiness({ ...neutral, energy: 6, soreness: 2, lifeStress: 9, sleepQuality: 2 });
  assert.equal(r.band, 'easy');
  assert.equal(r.sufficientData, false);
  assert.ok(r.drivers.some((d) => d.key === 'life_stress'));
});

test('recovery trends use calendar days; old low readings do not become consecutive', () => {
  assert.equal(recoveryPattern([{ day: '2026-09-08', band: 'easy' }, { day: '2026-09-10', band: 'easy' }], today).kind, 'unknown');
  assert.equal(recoveryPattern([{ day: '2026-09-12', band: 'easy' }, { day: today, band: 'easy' }], today).kind, 'strained');
  assert.equal(recoveryPattern([{ day: today, band: 'easy' }, { day: today, band: 'easy' }], today).observedDays, 1);
});

test('partial check-ins never mean the athlete feels fine', () => {
  const r = decideReadinessGate({ coachingMode: 'autonomous', band: 'easy', sessionType: 'tempo',
    ranToday: false, isRestDay: false, checkedInToday: true, energy: null, soreness: null });
  assert.equal(r.kind, 'ask');
});
