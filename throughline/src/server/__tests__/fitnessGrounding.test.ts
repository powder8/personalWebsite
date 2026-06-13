import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessGrounding, type DemonstratedEffort } from '../fitnessGrounding';

const eff = (vdot: number): DemonstratedEffort => ({
  vdot,
  distanceLabel: '10K',
  timeLabel: '38:42',
  paceLabel: '6:14/mi',
  day: '2026-05-30',
});

test('no demonstrated effort → provisional, no anchor offer', () => {
  const g = assessGrounding({ anchorVdot: 65, demonstrated: null });
  assert.equal(g.status, 'no_data');
  assert.equal(g.offerRecentAnchor, false);
  assert.match(g.note, /provisional|calibrate|haven|stated goal/i);
});

test('no anchor at all → provisional', () => {
  assert.equal(assessGrounding({ anchorVdot: null, demonstrated: eff(52) }).status, 'no_data');
});

test('anchor much faster than demonstrated → optimistic + offers re-anchor', () => {
  const g = assessGrounding({ anchorVdot: 65, demonstrated: eff(52), anchor5kLabel: '15:53' });
  assert.equal(g.status, 'optimistic');
  assert.equal(g.offerRecentAnchor, true);
  assert.equal(g.deltaVdot, 13);
  assert.match(g.note, /15:53/);
  assert.match(g.note, /38:42/);
});

test('demonstrated faster than anchor → conservative + offers raise', () => {
  const g = assessGrounding({ anchorVdot: 50, demonstrated: eff(56) });
  assert.equal(g.status, 'conservative');
  assert.equal(g.offerRecentAnchor, true);
  assert.equal(g.deltaVdot, -6);
});

test('anchor matches demonstrated → confirmed, no offer', () => {
  const g = assessGrounding({ anchorVdot: 53, demonstrated: eff(52.2) });
  assert.equal(g.status, 'confirmed');
  assert.equal(g.offerRecentAnchor, false);
  assert.match(g.note, /lines up/i);
});

test('stated goal far above demonstrated → goalStretch flag + honest note', () => {
  const g = assessGrounding({
    anchorVdot: 52,
    demonstrated: eff(52),
    statedGoalVdot: 65,
    statedGoalLabel: '2:38 marathon',
  });
  assert.equal(g.status, 'confirmed'); // anchor itself is grounded...
  assert.equal(g.goalStretch, true); // ...but the GOAL is a stretch
  assert.match(g.note, /2:38 marathon/);
  assert.match(g.note, /stretch/i);
});

test('modest gap within tolerance is not flagged', () => {
  assert.equal(assessGrounding({ anchorVdot: 53.5, demonstrated: eff(52) }).status, 'confirmed');
});

test('grade-adjusted effort is called out in the note', () => {
  const g = assessGrounding({ anchorVdot: 53, demonstrated: { ...eff(52.5), gradeAdjusted: true } });
  assert.match(g.note, /grade-adjusted for the hills/i);
});
