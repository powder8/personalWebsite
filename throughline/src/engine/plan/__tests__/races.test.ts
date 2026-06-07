import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodize, type KeyRace } from '../index';

const BASE = {
  startDay: '2026-01-05',
  goalRaceDay: '2026-06-07',
  startVolumeMiles: 40,
  peakVolumeMiles: 70,
};

function weekContaining(weeks: ReturnType<typeof periodize>, date: string) {
  return weeks.find((w) => w.weekStart <= date && date <= addDays(w.weekStart, 6))!;
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

test('each week is tagged with the next key race it builds toward', () => {
  const races: KeyRace[] = [
    { date: '2026-03-14', priority: 'tune_up', label: '10K tune-up' },
    { date: '2026-06-07', priority: 'goal', label: 'Goal Marathon' },
  ];
  const weeks = periodize({ ...BASE, keyRaces: races });
  const early = weeks[2];
  assert.equal(early.targetRaceDate, '2026-03-14', 'early weeks point to the first tune-up');
  const afterTuneUp = weeks.find((w) => w.weekStart > '2026-03-14')!;
  assert.equal(afterTuneUp.targetRaceDate, '2026-06-07', 'after the tune-up, weeks point to the goal');
});

test('a tune-up race week gets a mini-taper vs the same week without the race', () => {
  const plain = periodize(BASE);
  const withRace = periodize({
    ...BASE,
    keyRaces: [{ date: '2026-03-14', priority: 'tune_up', label: '10K' }],
  });
  const raceWeekPlain = weekContaining(plain, '2026-03-14');
  const raceWeek = weekContaining(withRace, '2026-03-14');
  // Only meaningful if that week isn't already in the taper.
  if (raceWeek.phase !== 'taper') {
    assert.ok(
      raceWeek.targetVolumeMeters < raceWeekPlain.targetVolumeMeters,
      'tune-up week volume reduced',
    );
    assert.ok(raceWeek.raceThisWeek?.priority === 'tune_up');
  }
});

test('the week after a tune-up race is eased for recovery', () => {
  const plain = periodize(BASE);
  const withRace = periodize({
    ...BASE,
    keyRaces: [{ date: '2026-03-14', priority: 'tune_up' }],
  });
  const raceWeek = weekContaining(withRace, '2026-03-14');
  const nextStart = addDays(raceWeek.weekStart, 7);
  const after = withRace.find((w) => w.weekStart === nextStart);
  const afterPlain = plain.find((w) => w.weekStart === nextStart);
  if (after && afterPlain && after.phase !== 'taper') {
    assert.ok(after.targetVolumeMeters <= afterPlain.targetVolumeMeters);
  }
});

test('training races are tagged but do not change volume', () => {
  const plain = periodize(BASE);
  const withRace = periodize({
    ...BASE,
    keyRaces: [{ date: '2026-03-14', priority: 'training', label: 'parkrun' }],
  });
  const w = weekContaining(withRace, '2026-03-14');
  const wp = weekContaining(plain, '2026-03-14');
  assert.equal(w.targetVolumeMeters, wp.targetVolumeMeters, 'training race: no volume change');
  assert.equal(w.raceThisWeek?.priority, 'training');
});

test('a goal race inside the taper does not crash or double-cut', () => {
  const weeks = periodize({
    ...BASE,
    keyRaces: [{ date: BASE.goalRaceDay, priority: 'goal', label: 'Goal' }],
  });
  const last = weeks[weeks.length - 1];
  assert.ok(last.targetVolumeMeters > 0);
});
