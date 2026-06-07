/**
 * Pure week diff for the draft → preview → publish flow. Compares a currently
 * published week against a freshly generated/adapted draft, so the coach sees
 * exactly what a replan changes before approving.
 */
import type { PlannedDay, PlannedWeek } from './types';
import { metersToMiles } from './zones';

export interface DayDiff {
  day: string;
  kind: 'added' | 'removed' | 'changed' | 'unchanged';
  fields: string[]; // which fields differ (for 'changed')
  before?: PlannedDay;
  after?: PlannedDay;
}

export interface WeekDiff {
  weekStart: string;
  days: DayDiff[];
  changedCount: number;
}

const COMPARED: (keyof PlannedDay)[] = [
  'runType',
  'zone',
  'distanceMeters',
  'description',
  'pinned',
  'optionalStrides',
];

function changedFields(a: PlannedDay, b: PlannedDay): string[] {
  const out: string[] = [];
  for (const f of COMPARED) {
    if (f === 'distanceMeters') {
      // Treat sub-0.1-mile differences as noise.
      if (Math.abs(metersToMiles(a.distanceMeters) - metersToMiles(b.distanceMeters)) >= 0.1) {
        out.push(f);
      }
    } else if (a[f] !== b[f]) {
      out.push(f as string);
    }
  }
  return out;
}

export function diffWeek(before: PlannedWeek | null, after: PlannedWeek): WeekDiff {
  const beforeByDay = new Map((before?.days ?? []).map((d) => [d.day, d]));
  const afterByDay = new Map(after.days.map((d) => [d.day, d]));
  const allDays = Array.from(new Set([...beforeByDay.keys(), ...afterByDay.keys()])).sort();

  const days: DayDiff[] = allDays.map((day) => {
    const b = beforeByDay.get(day);
    const a = afterByDay.get(day);
    if (!b && a) return { day, kind: 'added', fields: [], after: a };
    if (b && !a) return { day, kind: 'removed', fields: [], before: b };
    const fields = changedFields(b!, a!);
    return {
      day,
      kind: fields.length ? 'changed' : 'unchanged',
      fields,
      before: b,
      after: a,
    };
  });

  return {
    weekStart: after.weekStart,
    days,
    changedCount: days.filter((d) => d.kind !== 'unchanged').length,
  };
}
