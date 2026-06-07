import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { parseTrainingLogFile, parseAvgPace, type ParsedDay } from '../parseTrainingLog';

const FIXTURE = join(process.cwd(), 'sample-data', 'moira-build-2021.xlsx');
const hasFixture = existsSync(FIXTURE);
const FLAT_FIXTURE = join(process.cwd(), 'sample-data', 'heather-tanner-rclog.xlsx');
const hasFlat = existsSync(FLAT_FIXTURE);

// --- pure pace parsing (no file needed) ---

test('parseAvgPace only fires on marked averages, not interval splits', () => {
  assert.ok(parseAvgPace('Easy 7:19 avg') !== null);
  assert.ok(parseAvgPace('Avg 6:56') !== null);
  assert.ok(parseAvgPace('7 flat') !== null);
  // interval splits like "3:32/2:33" must NOT be read as a run pace
  assert.equal(parseAvgPace('3:32/2:33, 3:33/2:34'), null);
  assert.equal(parseAvgPace('As written'), null);
});

test('parseAvgPace converts min/mile to sec/km in a sane range', () => {
  const p = parseAvgPace('7:00 avg'); // 7:00/mi ≈ 261 s/km
  assert.ok(p !== null && p > 255 && p < 268);
});

// --- real-file parsing (skipped if the private fixture isn't present) ---

test('parses the real Moira training log', { skip: !hasFixture }, async () => {
  const days = await parseTrainingLogFile(FIXTURE, { year: 2021 });

  assert.ok(days.length > 120, `expected many days, got ${days.length}`);
  // Every day has a valid ISO date in 2021, ordered ascending and unique.
  let prev = '';
  for (const d of days) {
    assert.match(d.date, /^2021-\d{2}-\d{2}$/);
    assert.ok(d.date > prev, 'dates strictly ascending after de-dupe');
    prev = d.date;
  }

  // The date-coercion bug is pervasive and must be reversed to mile ranges.
  const bugged = days.filter((d) => d.assignedMiles?.wasDateBug);
  assert.ok(bugged.length > 50, `expected many date-bug reversals, got ${bugged.length}`);
  for (const d of bugged) {
    const a = d.assignedMiles!;
    assert.ok(Number.isInteger(a.lo) && Number.isInteger(a.hi) && a.lo <= a.hi);
    assert.ok(a.hi <= 31 && a.value === (a.lo + a.hi) / 2);
  }

  // Some average paces were recovered from free-text descriptions.
  assert.ok(days.filter((d) => d.avgPaceSecPerKm != null).length > 20);

  // Plausible elite weekly volume: a peak week clears 55 miles of actual running.
  const byWeek = new Map<string, number>();
  for (const d of days) {
    if (!d.actualMiles) continue;
    const wk = d.date.slice(0, 7);
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + d.actualMiles);
  }
  assert.ok(Math.max(...byWeek.values()) > 200, 'a peak month exceeds 200 mi');

  // Mostly running.
  const runs = days.filter((d: ParsedDay) => d.sport === 'run').length;
  assert.ok(runs / days.length > 0.7);
});

test('parses a flat daily-log format and picks IMPERIAL columns (not metric)', { skip: !hasFlat }, async () => {
  const days = await parseTrainingLogFile(FLAT_FIXTURE, { year: 2013 });
  assert.ok(days.length > 300, `expected many days, got ${days.length}`);
  // Real dates → no date-bug reversals.
  assert.ok(!days.some((d) => d.assignedMiles?.wasDateBug));

  // Miles must be imperial (~10), NOT the parallel km column (~16).
  const easy = days.find((d) => /easy/i.test(d.workout) && d.actualMiles != null)!;
  assert.ok(easy.actualMiles! < 14, `imperial miles expected, got ${easy.actualMiles}`);

  // The "Log Pace Per Mile" column (an Excel time value) is read as the ACTUAL
  // pace — so paces vary across runs (not all the prescribed pace).
  const paces = days.map((d) => d.avgPaceSecPerKm).filter((p): p is number => p != null);
  assert.ok(paces.length > 100, `expected many logged paces, got ${paces.length}`);
  // sane mile-pace range (~4:00–9:00/mi → s/km), incl. fast speed sessions.
  assert.ok(paces.every((p) => p > 140 && p < 360), 'paces in a sane mile-pace range');
  assert.ok(new Set(paces.map((p) => Math.round(p))).size > 20, 'actual paces vary, not a single value');
});
