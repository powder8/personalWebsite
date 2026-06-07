import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestRaceWindows, annotateWindows, buildZonesFromVdot, vdotFromRace, midpoint } from '../index';

const startDay = '2026-01-05';
const goalMarathon = { date: '2026-06-07', distanceLabel: 'Marathon' }; // ~22 weeks out

test('suggests windows in chronological order, all before the goal', () => {
  const w = suggestRaceWindows(goalMarathon, startDay);
  assert.ok(w.length >= 3);
  let prev = '';
  for (const win of w) {
    assert.ok(win.fromDate > prev);
    prev = win.fromDate;
    assert.ok(win.toDate < goalMarathon.date, 'window ends before the goal');
    assert.ok(win.fromDate >= startDay, 'window starts after the build start');
  }
});

test('marathon goal recommends a half for the specificity tune-up', () => {
  const w = suggestRaceWindows(goalMarathon, startDay);
  const spec = w.find((x) => x.kind === 'specificity_tuneup')!;
  assert.ok(spec.suggestedDistances.includes('Half'));
  assert.equal(spec.priority, 'tune_up');
});

test('final sharpener sits 2–3 weeks out and is short', () => {
  const w = suggestRaceWindows(goalMarathon, startDay);
  const sharp = w.find((x) => x.kind === 'final_sharpener')!;
  assert.equal(sharp.minWeeksOut, 2);
  assert.ok(sharp.suggestedDistances.every((d) => ['Mile', '3K', '5K', '10K'].includes(d)));
});

test('short builds drop the far windows', () => {
  const w = suggestRaceWindows({ date: '2026-02-16', distanceLabel: 'Half' }, startDay); // ~6 weeks
  assert.ok(!w.some((x) => x.kind === 'opener'), 'no early opener in a short build');
  assert.ok(w.some((x) => x.kind === 'final_sharpener'));
});

test('a goal under 3 weeks out yields no windows', () => {
  assert.deepEqual(suggestRaceWindows({ date: '2026-01-19', distanceLabel: '10K' }, startDay), []);
});

test('distances scale with goal class (half goal → shorter tune-ups)', () => {
  const w = suggestRaceWindows({ date: '2026-06-07', distanceLabel: 'Half' }, startDay);
  const spec = w.find((x) => x.kind === 'specificity_tuneup')!;
  assert.ok(!spec.suggestedDistances.includes('Half'), 'half goal should not tune up with a half');
});

test('each window carries a primary distance, course profile, and effort note', () => {
  const w = suggestRaceWindows(goalMarathon, startDay);
  for (const win of w) {
    assert.ok(win.primaryDistance.length > 0);
    assert.ok(win.suggestedDistances.includes(win.primaryDistance));
    assert.ok(win.courseProfile.length > 0);
    assert.ok(win.effortNote.length > 0);
    assert.equal(win.targetPace, null, 'no pace without zones');
  }
});

test('with zones, windows get a personalized target pace; shorter races are faster', () => {
  const zones = buildZonesFromVdot(vdotFromRace({ distanceMeters: 21097.5, timeSeconds: 73 * 60 }));
  const w = suggestRaceWindows(goalMarathon, startDay, zones);
  const sharp = w.find((x) => x.kind === 'final_sharpener')!; // short → fast
  const spec = w.find((x) => x.kind === 'specificity_tuneup')!; // Half → slower
  assert.ok(sharp.targetPace && sharp.targetPaceLabel?.includes('/mi'));
  assert.ok(spec.targetPace);
  assert.ok(
    midpoint(sharp.targetPace!) < midpoint(spec.targetPace!),
    'a short sharpener targets a faster pace than a half tune-up',
  );
});

test('annotateWindows marks windows already filled by a scheduled race', () => {
  const w = suggestRaceWindows(goalMarathon, startDay);
  const spec = w.find((x) => x.kind === 'specificity_tuneup')!;
  const midDate = spec.fromDate; // inside the window
  const annotated = annotateWindows(w, [{ date: midDate, name: 'Some Half' }]);
  const filled = annotated.find((x) => x.kind === 'specificity_tuneup')!;
  assert.ok(filled.filledBy && filled.filledBy.name === 'Some Half');
  const empty = annotated.find((x) => x.kind === 'final_sharpener')!;
  assert.equal(empty.filledBy, null);
});
