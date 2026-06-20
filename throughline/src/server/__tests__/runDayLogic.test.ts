import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickPrimaryRun, summarizeRunDay, type DayRunLike } from '@/server/runDayLogic';

const r = (over: Partial<DayRunLike & { activityId: string }> = {}): DayRunLike & { activityId: string } => ({
  activityId: 'x',
  workoutType: null,
  miles: 3,
  paceSecPerKm: 300,
  ...over,
});

test('warm-up + 5K race + cool-down → the RACE is primary, not the cool-down', () => {
  const runs = [
    r({ activityId: 'warmup', workoutType: null, miles: 1.5, paceSecPerKm: 360 }),
    r({ activityId: 'race', workoutType: 1, miles: 3.1, paceSecPerKm: 230 }),
    r({ activityId: 'cooldown', workoutType: null, miles: 1.2, paceSecPerKm: 380 }),
  ];
  assert.equal(pickPrimaryRun(runs)!.activityId, 'race');
});

test('no race flag → longest run wins (a warm-up shouldn’t beat the main run)', () => {
  const runs = [
    r({ activityId: 'warmup', miles: 2, paceSecPerKm: 360 }),
    r({ activityId: 'main', miles: 6, paceSecPerKm: 300 }),
    r({ activityId: 'cooldown', miles: 1, paceSecPerKm: 380 }),
  ];
  assert.equal(pickPrimaryRun(runs)!.activityId, 'main');
});

test('workout flag beats a longer easy run', () => {
  const runs = [
    r({ activityId: 'easy', workoutType: null, miles: 8, paceSecPerKm: 330 }),
    r({ activityId: 'workout', workoutType: 3, miles: 5, paceSecPerKm: 250 }),
  ];
  assert.equal(pickPrimaryRun(runs)!.activityId, 'workout');
});

test('equal distance → the faster effort is primary', () => {
  const runs = [
    r({ activityId: 'a', miles: 4, paceSecPerKm: 320 }),
    r({ activityId: 'b', miles: 4, paceSecPerKm: 260 }),
  ];
  assert.equal(pickPrimaryRun(runs)!.activityId, 'b');
});

test('single run → that run; empty → null', () => {
  assert.equal(pickPrimaryRun([r({ activityId: 'solo' })])!.activityId, 'solo');
  assert.equal(pickPrimaryRun([]), null);
});

test('summary totals the day and flags a race', () => {
  const runs = [r({ miles: 1.5 }), r({ workoutType: 1, miles: 3.1 }), r({ miles: 1.2 })];
  const s = summarizeRunDay(runs);
  assert.equal(s.count, 3);
  assert.equal(s.totalMiles, 5.8);
  assert.equal(s.hasRace, true);
});
