/**
 * PURE multisport compliance — planned vs actual, one week at a time (no DB).
 *
 * The old model was run-only three ways at once: one planned session per day
 * (a tri day's bike overwrote its run), planned volume measured in miles (a
 * ride prescribes minutes, so it read as 0 and was "missed unless you ran"),
 * and adherence that only ever counted run days. Every ride was demoted to
 * "cross-training" even when a ride was exactly what was planned.
 *
 * This model judges EACH planned session in ITS OWN unit against activity in
 * THE SAME sport — run and swim by distance, bike and strength by time — and
 * counts adherence across every discipline. Cross-training is now precisely
 * what it should mean: activity in a sport that had nothing planned that day.
 */

export type DayStatus = 'done' | 'partial' | 'missed' | 'upcoming' | 'rest' | 'extra';
export type Discipline = 'run' | 'bike' | 'swim' | 'strength';

/** A planned session after directives, with its native-unit target. */
export interface PlannedRef {
  day: string;
  discipline: Discipline;
  sessionType: string;
  /** run / swim prescribe distance; bike / strength prescribe time. 0 = no volume. */
  targetMeters: number;
  targetSeconds: number;
}

/** A logged activity. */
export interface ActualRef {
  day: string;
  sport: string;
  meters: number;
  seconds: number;
}

/** One planned session's verdict, in the athlete-facing day detail. */
export interface SessionVerdict {
  discipline: Discipline;
  sessionType: string;
  status: 'done' | 'partial' | 'missed' | 'upcoming';
  /** actual / target in the session's own unit, when a target exists. */
  ratio: number | null;
}

export interface ComplianceDay {
  day: string;
  /** The day's PRIMARY planned session type (run first), null = nothing planned. */
  sessionType: string | null;
  plannedMiles: number; // RUN miles planned
  actualMiles: number; // RUN miles logged — a ride never satisfies a run target
  crossTrainSessions: number; // activity in sports with NOTHING planned that day
  crossTrainMinutes: number;
  status: DayStatus;
  /** Every planned session that day, judged in its own unit. */
  sessions: SessionVerdict[];
}

export interface ComplianceWeek {
  weekStart: string;
  weekEnd: string;
  phase: string | null;
  plannedMiles: number; // run
  actualMiles: number; // run
  crossTrainSessions: number;
  crossTrainMinutes: number;
  /** Planned WORK sessions due so far, across every discipline. */
  sessionsPlanned: number;
  sessionsDone: number;
  adherencePct: number | null;
  days: ComplianceDay[];
}

const MI = 1609.344;
/** Hitting 80% of the prescription counts as done — a slightly short session is still the session. */
const DONE_RATIO = 0.8;
const DISCIPLINE_ORDER: Discipline[] = ['run', 'bike', 'swim', 'strength'];

export function isTimePrescribed(d: Discipline): boolean {
  return d === 'bike' || d === 'strength';
}

/** Does this planned session prescribe real work? */
export function plannedHasVolume(p: PlannedRef): boolean {
  if (p.sessionType === 'rest') return false;
  return isTimePrescribed(p.discipline) ? p.targetSeconds > 0 : p.targetMeters > 0;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Judge one planned session against that day's activity in the same sport. */
export function judgeSession(
  p: PlannedRef,
  actual: { meters: number; seconds: number } | undefined,
  isPast: boolean,
): SessionVerdict {
  const base = { discipline: p.discipline, sessionType: p.sessionType };
  if (!isPast) return { ...base, status: 'upcoming', ratio: null };
  const got = actual ? (isTimePrescribed(p.discipline) ? actual.seconds : actual.meters) : 0;
  const target = isTimePrescribed(p.discipline) ? p.targetSeconds : p.targetMeters;
  if (target <= 0) {
    // Planned but no volume prescribed: any session in that sport counts.
    return { ...base, status: got > 0 || (actual && (actual.seconds > 0 || actual.meters > 0)) ? 'done' : 'missed', ratio: null };
  }
  const ratio = got / target;
  return { ...base, status: ratio >= DONE_RATIO ? 'done' : ratio > 0 ? 'partial' : 'missed', ratio };
}

export function evaluateWeek(input: {
  weekStart: string;
  weekEnd: string;
  phase: string | null;
  today: string;
  planned: PlannedRef[];
  actuals: ActualRef[];
}): ComplianceWeek {
  const { weekStart, weekEnd, phase, today } = input;

  // Planned sessions per day, per discipline (a tri day keeps BOTH its sessions).
  const plannedByDay = new Map<string, PlannedRef[]>();
  for (const p of input.planned) {
    if (p.day < weekStart || p.day > weekEnd) continue;
    plannedByDay.set(p.day, [...(plannedByDay.get(p.day) ?? []), p]);
  }
  // Actual volume per day, per sport, in native units.
  const actualByDay = new Map<string, Map<string, { meters: number; seconds: number; sessions: number }>>();
  for (const a of input.actuals) {
    if (a.day < weekStart || a.day > weekEnd) continue;
    const bySport = actualByDay.get(a.day) ?? new Map();
    const cur = bySport.get(a.sport) ?? { meters: 0, seconds: 0, sessions: 0 };
    cur.meters += a.meters;
    cur.seconds += a.seconds;
    cur.sessions += 1;
    bySport.set(a.sport, cur);
    actualByDay.set(a.day, bySport);
  }

  const days: ComplianceDay[] = [];
  let plannedMiles = 0;
  let actualMiles = 0;
  let crossTrainSessions = 0;
  let crossTrainMinutes = 0;
  let sessionsPlanned = 0;
  let sessionsDone = 0;

  for (let d = weekStart; d <= weekEnd; d = addDays(d, 1)) {
    const isPast = d <= today;
    const plannedAll = plannedByDay.get(d) ?? [];
    const work = plannedAll.filter(plannedHasVolume);
    const bySport = actualByDay.get(d) ?? new Map<string, { meters: number; seconds: number; sessions: number }>();

    // Run miles keep their dedicated columns (the run-specific consumers read them).
    const runPlanned = plannedAll.filter((p) => p.discipline === 'run').reduce((s, p) => s + p.targetMeters, 0) / MI;
    const runActual = (bySport.get('run')?.meters ?? 0) / MI;
    plannedMiles += runPlanned;
    actualMiles += runActual;

    // Judge every planned session in its own unit against its own sport.
    const sessions: SessionVerdict[] = work.map((p) => judgeSession(p, bySport.get(p.discipline), isPast));

    // Cross-training = activity in a sport with NOTHING planned that day.
    const plannedSports = new Set(plannedAll.filter((p) => p.sessionType !== 'rest').map((p) => p.discipline));
    let xtSessions = 0;
    let xtMinutes = 0;
    for (const [sport, v] of bySport) {
      if (plannedSports.has(sport as Discipline)) continue;
      xtSessions += v.sessions;
      xtMinutes += Math.round(v.seconds / 60);
    }
    crossTrainSessions += xtSessions;
    crossTrainMinutes += xtMinutes;

    const anyActivity = [...bySport.values()].some((v) => v.sessions > 0);
    let status: DayStatus;
    if (work.length === 0) {
      status = anyActivity ? 'extra' : 'rest';
    } else if (!isPast) {
      status = 'upcoming';
    } else {
      const done = sessions.filter((s) => s.status === 'done').length;
      const started = sessions.filter((s) => s.status === 'done' || s.status === 'partial').length;
      status = done === sessions.length ? 'done' : started > 0 ? 'partial' : 'missed';
      sessionsPlanned += sessions.length;
      sessionsDone += done;
    }

    // Primary session type: run first, then the discipline order.
    const primary =
      DISCIPLINE_ORDER.map((disc) => plannedAll.find((p) => p.discipline === disc)).find(Boolean) ?? plannedAll[0] ?? null;

    days.push({
      day: d,
      sessionType: primary?.sessionType ?? null,
      plannedMiles: runPlanned,
      actualMiles: runActual,
      crossTrainSessions: xtSessions,
      crossTrainMinutes: xtMinutes,
      status,
      sessions,
    });
  }

  return {
    weekStart,
    weekEnd,
    phase,
    plannedMiles,
    actualMiles,
    crossTrainSessions,
    crossTrainMinutes,
    sessionsPlanned,
    sessionsDone,
    adherencePct: sessionsPlanned > 0 ? Math.round((sessionsDone / sessionsPlanned) * 100) : null,
    days,
  };
}
