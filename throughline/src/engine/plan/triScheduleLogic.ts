/**
 * Triathlon schedule-constraint layer (PURE, DB-free — no `server-only`, no clock).
 *
 * The allocator (`triAllocatorLogic.ts`) decides HOW MUCH of each sport to do and
 * the per-sport generators decide WHAT the sessions are; this layer decides WHICH
 * REAL-WORLD DAY each session lands on, honoring the athlete's actual weekly
 * windows. It implements the spec's day-layout model — a `DayBudget` per weekday
 * (`triathlon-time-optimization-spec.md` §1.3) and the greedy "LAY OUT DAYS" step
 * (§7.3 step 6), with graceful degradation when the week doesn't fit (§7.5).
 *
 * (The task brief calls this "§4 of the goal-time-and-schedule spec"; that
 * consolidated doc doesn't exist on this branch — the authoritative source is
 * §1.3 + §6 + §7.3/§7.5 of `triathlon-time-optimization-spec.md`, which this
 * matches.)
 *
 * Placement rules honored, in order of how hard the constraint is:
 *   - the LONG session / brick lands on an `isLongDay` window (where a long ride +
 *     a run co-locate — §6.1);
 *   - SWIMS land only on `poolAccess` days (pool time is a hard external
 *     constraint — §1.3 `swimAccess`);
 *   - never STACK two quality/hard sessions on one day (§7.3 step 6);
 *   - respect each day's `availableMinutes`;
 *   - protect ≥1 recovery/rest day;
 *   - when the week can't fit, DROP the lowest-priority optional volume first and
 *     record what was dropped + why (the floor-first degrade of §7.5).
 *
 * ⚠️ TUNABLE CONSTANTS. The default per-day minutes, the easy-run pace used to
 * price run distance → minutes, and the rest-day heuristic are DEFENSIBLE
 * DEFAULTS, layered global→override in the same house style as
 * `triAllocatorLogic.ts`. Nothing here is a hard physiological law.
 *
 * ADDITIVE / no-schedule pass-through: with no `WeekSchedule`, `layoutTriWeek`
 * reproduces today's naive by-day-of-week placement byte-for-byte (each session
 * on the day-of-week its generator chose), so wiring it in changes nothing until
 * a real schedule is supplied. Intended call site: `composeTriWeek` in
 * `triPlan.ts` — build sessions from the per-sport `PlannedWeek`s
 * (`sessionsFromPlannedWeeks`), lay them out, then re-key the composed `TriDay`s
 * off the result. This story does NOT modify `triPlan.ts`.
 */
import type { Discipline, PlannedDay, PlannedWeek } from './types';
import { TRI_DISCIPLINES } from './triAllocatorLogic';

// ---------------------------------------------------------------------------
// Tunable model (global defaults; override per athlete/week)
// ---------------------------------------------------------------------------

/** Default training window (minutes) for an ordinary available weekday. */
export const DEFAULT_AVAILABLE_MINUTES = 90;

/** Default window (minutes) for the one long-session day — a weekend-sized block. */
export const DEFAULT_LONG_DAY_MINUTES = 240;

/**
 * Easy-run pace (min/km) used ONLY to price a run session's `distanceMeters` into
 * minutes (run days carry distance, not duration, unlike bike/swim). ~6:00/km is a
 * representative easy pace; tunable alongside the allocator's `RUN_TRAINING_PACE_RATIO`.
 */
export const DEFAULT_RUN_PACE_MIN_PER_KM = 6.0;

/** Weekday indices, engine convention: 0=Mon … 6=Sun. */
const DOWS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

// ---------------------------------------------------------------------------
// The schedule model (§1.3)
// ---------------------------------------------------------------------------

/**
 * One weekday's real-world training window (spec §1.3 `DayBudget`). Index by
 * day-of-week, 0=Mon … 6=Sun. A non-training day is simply `availableMinutes: 0`.
 */
export interface DayBudget {
  /** Longest session realistically doable this day (§1.3 `maxMinutes`, the p90 window). */
  availableMinutes: number;
  /** Pool available this day — swims may land ONLY here (§1.3 `swimAccess`). */
  poolAccess: boolean;
  /** A long-session window (the p90 outlier day) where the long ride / brick lives (§6.1). */
  isLongDay: boolean;
}

/** The whole week: exactly 7 `DayBudget`s, index 0=Mon … 6=Sun. */
export type WeekSchedule = readonly DayBudget[];

/** Compact description of a week the {@link buildWeekSchedule} constructor expands. */
export interface WeekScheduleSpec {
  /** Weekdays (dow) with ANY training time. Defaults to all seven. */
  availableDays?: number[];
  /** Weekdays (dow) with pool access. Defaults to none. */
  poolDays?: number[];
  /** The single long-session day (dow). Defaults to none (no long window). */
  longDay?: number;
  /** Default minutes for an ordinary available day. */
  defaultMinutes?: number;
  /** Minutes for the long day (defaults to {@link DEFAULT_LONG_DAY_MINUTES}). */
  longDayMinutes?: number;
  /** Per-dow minute overrides (wins over the defaults above). */
  perDayMinutes?: Partial<Record<number, number>>;
}

/**
 * Build a 7-day {@link WeekSchedule} from a compact spec. Every day the spec omits
 * is a rest window (`availableMinutes: 0`), so the schedule is complete and pure.
 */
export function buildWeekSchedule(spec: WeekScheduleSpec): WeekSchedule {
  const available = new Set(spec.availableDays ?? [...DOWS]);
  const pool = new Set(spec.poolDays ?? []);
  const defaultMinutes = spec.defaultMinutes ?? DEFAULT_AVAILABLE_MINUTES;
  const longDayMinutes = spec.longDayMinutes ?? DEFAULT_LONG_DAY_MINUTES;
  return DOWS.map((dow): DayBudget => {
    const isLongDay = spec.longDay === dow;
    if (!available.has(dow)) {
      return { availableMinutes: 0, poolAccess: false, isLongDay: false };
    }
    const minutes =
      spec.perDayMinutes?.[dow] ?? (isLongDay ? longDayMinutes : defaultMinutes);
    return { availableMinutes: minutes, poolAccess: pool.has(dow), isLongDay };
  });
}

// ---------------------------------------------------------------------------
// The session model (what the layout places)
// ---------------------------------------------------------------------------

/**
 * One trainable session in the week's pool, carrying just what placement needs:
 * discipline, an estimated duration, quality/long flags derived from the
 * `PlannedDay`, and the day-of-week its GENERATOR chose (the naive placement the
 * no-schedule pass-through reproduces).
 */
export interface TriScheduleSession {
  /** Stable id for determinism + drop reporting (e.g. `${discipline}-${dow}`). */
  id: string;
  discipline: Discipline;
  /** Estimated session duration (minutes). */
  minutes: number;
  /** The generator's native day-of-week (0=Mon … 6=Sun) — the naive placement. */
  dow: number;
  /** A long/endurance session — must land on an `isLongDay` window. */
  isLong: boolean;
  /** A quality/hard session — at most one such may share a day. */
  isQuality: boolean;
  /** The originating planned day, carried through so callers can re-emit it. */
  source?: PlannedDay;
}

/** One weekday after layout: the sessions placed on it and how full it is. */
export interface PlacedDay {
  dow: number;
  sessions: TriScheduleSession[];
  /** Minutes consumed (Σ session minutes). */
  usedMinutes: number;
  /** A brick day: a bike AND a run co-located (do the run off the bike — §6.1). */
  isBrick: boolean;
}

/** A session the week couldn't fit, with the constraint that dropped it. */
export interface DroppedSession {
  session: TriScheduleSession;
  reason: string;
}

/** The result of laying the week's sessions across seven real-world days. */
export interface TriLayoutResult {
  /** Placed sessions per weekday, index 0=Mon … 6=Sun (rest days are empty). */
  days: PlacedDay[];
  /** Sessions that didn't fit (lowest-priority optional volume first). */
  dropped: DroppedSession[];
  /** Coach-facing rationale (rest day protected, what was dropped and why). */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Deriving sessions from planned weeks (the intended call-site helper)
// ---------------------------------------------------------------------------

/**
 * Estimate a planned day's duration in minutes. Bike/swim carry `durationSeconds`
 * directly; run days carry `distanceMeters`, priced at {@link DEFAULT_RUN_PACE_MIN_PER_KM}.
 */
export function estimateSessionMinutes(pd: PlannedDay): number {
  if (typeof pd.durationSeconds === 'number' && pd.durationSeconds > 0) {
    return pd.durationSeconds / 60;
  }
  if (pd.distanceMeters > 0) {
    return (pd.distanceMeters / 1000) * DEFAULT_RUN_PACE_MIN_PER_KM;
  }
  return 0;
}

/** True when a planned day is a hard/quality session (at most one per day). */
function isQualityDay(pd: PlannedDay): boolean {
  return pd.runType === 'quality';
}

/** True when a planned day is a long/endurance session (long-day / brick candidate). */
function isLongDayType(pd: PlannedDay): boolean {
  return pd.runType === 'long';
}

/**
 * Flatten the per-sport `PlannedWeek`s of ONE calendar week into the session pool
 * `layoutTriWeek` consumes (skipping rest days). This is the bridge the intended
 * `composeTriWeek` call site uses; kept here so the layout is self-contained.
 */
export function sessionsFromPlannedWeeks(
  sportWeeks: Partial<Record<Discipline, PlannedWeek>>,
): TriScheduleSession[] {
  const out: TriScheduleSession[] = [];
  for (const d of TRI_DISCIPLINES) {
    const week = sportWeeks[d];
    if (!week) continue;
    for (const pd of week.days) {
      if (pd.runType === 'rest') continue;
      out.push({
        id: `${d}-${pd.dow}`,
        discipline: d,
        minutes: estimateSessionMinutes(pd),
        dow: pd.dow,
        isLong: isLongDayType(pd),
        isQuality: isQualityDay(pd),
        source: pd,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The greedy layout (§7.3 step 6)
// ---------------------------------------------------------------------------

/**
 * Placement priority — lower places EARLIER (so the most-constrained, highest-value
 * work claims its day first) and is DROPPED LAST (so over-full weeks shed the
 * lowest-priority optional volume first, §7.5). The ordering:
 *   0 long/brick   — pinned to the scarce long-day window;
 *   1 swim         — access-capped to pool days, and frequency-binding (§5);
 *   2 quality      — hard sessions that can't stack;
 *   3 optional     — easy/aerobic volume, the first to go when time is short.
 */
function priorityRank(s: TriScheduleSession): number {
  if (s.isLong) return 0;
  if (s.discipline === 'swim') return 1;
  if (s.isQuality) return 2;
  return 3;
}

/** Deterministic placement order: priority, then longest-first, then id. */
function placementOrder(a: TriScheduleSession, b: TriScheduleSession): number {
  const pr = priorityRank(a) - priorityRank(b);
  if (pr !== 0) return pr;
  if (b.minutes !== a.minutes) return b.minutes - a.minutes;
  return a.id.localeCompare(b.id);
}

/**
 * Choose the ONE day to protect as recovery/rest: among available, non-long days,
 * prefer a day with no pool access (nothing is access-locked to it) and the
 * smallest window, tie-broken by lowest dow. Deterministic; tunable heuristic.
 * Returns -1 when there's no day to spare (≤1 available day).
 */
function chooseRestDow(schedule: WeekSchedule): number {
  const candidates = DOWS.filter(
    (dow) => schedule[dow].availableMinutes > 0 && !schedule[dow].isLongDay,
  );
  // Never strand the athlete with zero training days: only reserve rest when there
  // are at least two available days to begin with.
  const availableCount = DOWS.filter((dow) => schedule[dow].availableMinutes > 0).length;
  if (availableCount <= 1 || candidates.length === 0) return -1;
  let best = candidates[0];
  for (const dow of candidates) {
    const a = schedule[dow];
    const b = schedule[best];
    // Prefer no-pool days, then the smallest window, then the lowest dow.
    const aScore: [number, number, number] = [a.poolAccess ? 1 : 0, a.availableMinutes, dow];
    const bScore: [number, number, number] = [b.poolAccess ? 1 : 0, b.availableMinutes, best];
    if (
      aScore[0] < bScore[0] ||
      (aScore[0] === bScore[0] && aScore[1] < bScore[1]) ||
      (aScore[0] === bScore[0] && aScore[1] === bScore[1] && aScore[2] < bScore[2])
    ) {
      best = dow;
    }
  }
  return best;
}

/** Why a session found no home — the tightest binding constraint, for the note. */
function dropReason(s: TriScheduleSession, schedule: WeekSchedule): string {
  if (s.isLong && !DOWS.some((d) => schedule[d].isLongDay && schedule[d].availableMinutes > 0)) {
    return 'no long-day window available for the long/brick session';
  }
  if (s.discipline === 'swim' && !DOWS.some((d) => schedule[d].poolAccess)) {
    return 'no pool-access day available for the swim';
  }
  return 'week over capacity — no day with room that avoids stacking a second hard session';
}

/**
 * Lay the week's sessions across seven real-world days.
 *
 * With NO `schedule`, this is a pass-through: each session stays on the day-of-week
 * its generator chose (the current naive behaviour), no constraints, no drops — so
 * the output is byte-identical to today.
 *
 * With a `schedule`, it runs the deterministic greedy of §7.3 step 6: place the
 * most-constrained, highest-value work first (long/brick → long day, swims → pool
 * days), never stack two hard sessions, respect each day's `availableMinutes`,
 * protect one rest day, and drop the lowest-priority optional volume (recording it)
 * when the week can't fit.
 */
export function layoutTriWeek(
  sessions: readonly TriScheduleSession[],
  schedule?: WeekSchedule,
): TriLayoutResult {
  // --- no-schedule pass-through: reproduce naive by-day-of-week placement ---
  if (!schedule) {
    const days: PlacedDay[] = DOWS.map((dow) => ({
      dow,
      sessions: [],
      usedMinutes: 0,
      isBrick: false,
    }));
    // Preserve input order within a day (matches how the generators emit days).
    for (const s of sessions) {
      const day = days[s.dow];
      day.sessions.push(s);
      day.usedMinutes += s.minutes;
    }
    for (const day of days) day.isBrick = computeBrick(day.sessions);
    return { days, dropped: [], notes: [] };
  }

  // --- constrained greedy placement ---
  const days: PlacedDay[] = DOWS.map((dow) => ({
    dow,
    sessions: [],
    usedMinutes: 0,
    isBrick: false,
  }));
  const dropped: DroppedSession[] = [];
  const notes: string[] = [];

  const restDow = chooseRestDow(schedule);
  const ordered = [...sessions].sort(placementOrder);

  for (const s of ordered) {
    const target = pickDay(s, days, schedule, restDow);
    if (target === -1) {
      dropped.push({ session: s, reason: dropReason(s, schedule) });
      continue;
    }
    days[target].sessions.push(s);
    days[target].usedMinutes += s.minutes;
  }

  for (const day of days) day.isBrick = computeBrick(day.sessions);

  // --- coach-facing notes ---
  if (restDow >= 0) notes.push(`Protected ${DOW_NAME[restDow]} as a recovery day.`);
  if (dropped.length > 0) {
    const summary = dropped
      .map((d) => `${d.session.discipline} (${d.reason})`)
      .join('; ');
    notes.push(
      `Week over-full: dropped ${dropped.length} lower-priority session(s) — ${summary}.`,
    );
  }

  return { days, dropped, notes };
}

/** Day names for notes (0=Mon … 6=Sun). */
const DOW_NAME: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A day is a brick when both a bike and a run land on it (do the run off the bike). */
function computeBrick(sessions: readonly TriScheduleSession[]): boolean {
  let bike = false;
  let run = false;
  for (const s of sessions) {
    if (s.discipline === 'bike') bike = true;
    if (s.discipline === 'run') run = true;
  }
  return bike && run;
}

/**
 * Pick the best day for a session honoring every hard constraint, or -1 if none
 * fits. Prefers the session's native dow (keeps the layout close to the naive
 * placement), else the valid day with the most remaining capacity.
 */
function pickDay(
  s: TriScheduleSession,
  days: readonly PlacedDay[],
  schedule: WeekSchedule,
  restDow: number,
): number {
  const candidates = DOWS.filter((dow) => dayAccepts(s, dow, days[dow], schedule[dow], restDow));
  if (candidates.length === 0) return -1;
  // Prefer the generator's native day when it's a legal home.
  if (candidates.includes(s.dow)) return s.dow;
  // Otherwise spread load: the legal day with the most headroom, lowest dow to break ties.
  let best = candidates[0];
  for (const dow of candidates) {
    const headroom = schedule[dow].availableMinutes - days[dow].usedMinutes;
    const bestHeadroom = schedule[best].availableMinutes - days[best].usedMinutes;
    if (headroom > bestHeadroom) best = dow;
  }
  return best;
}

/** Whether a specific day can legally take this session (all hard constraints). */
function dayAccepts(
  s: TriScheduleSession,
  dow: number,
  placed: PlacedDay,
  budget: DayBudget,
  restDow: number,
): boolean {
  if (budget.availableMinutes <= 0) return false; // rest window
  if (dow === restDow) return false; // protected recovery day
  if (s.discipline === 'swim' && !budget.poolAccess) return false; // pool-access gate
  if (s.isLong && !budget.isLongDay) return false; // long/brick → long window only
  if (placed.usedMinutes + s.minutes > budget.availableMinutes) return false; // time cap
  if (s.isQuality && placed.sessions.some((p) => p.isQuality)) return false; // no double-hard
  return true;
}

// ---------------------------------------------------------------------------
// Applying the layout to the PERSISTED plan (G7b)
// ---------------------------------------------------------------------------

/** The date `dow` days after a Monday weekStart ('YYYY-MM-DD'). */
function dateForDow(weekStart: string, dow: number): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dow)).toISOString().slice(0, 10);
}

/** A rest PlannedDay — matches what the generators emit for a rest day. */
function restDay(day: string, dow: number): PlannedDay {
  return { day, dow, runType: 'rest', zone: null, distanceMeters: 0, description: 'Rest day.', pinned: false };
}

/**
 * Rewrite each sport's `PlannedWeek` days onto the schedule-chosen days, so the
 * PERSISTED plan honors pool days / the long day / no hard-stacking — not just
 * the composed view. `composeTriWeek` builds a view; persistence stores these
 * per-sport weeks directly, so the layout has to move the days HERE, before they
 * are saved. Sessions the week can't fit are dropped (their day becomes rest).
 * No schedule → identity (callers simply skip this).
 */
export function relayTriPlanToSchedule(
  perSport: Record<Discipline, PlannedWeek[]>,
  schedule: WeekSchedule,
): Record<Discipline, PlannedWeek[]> {
  // Align the three sports' weeks by weekStart (they periodize off the same start).
  const byStart = new Map<string, Partial<Record<Discipline, PlannedWeek>>>();
  for (const d of TRI_DISCIPLINES) {
    for (const w of perSport[d]) {
      let slot = byStart.get(w.weekStart);
      if (!slot) {
        slot = {};
        byStart.set(w.weekStart, slot);
      }
      slot[d] = w;
    }
  }

  const out: Record<Discipline, PlannedWeek[]> = { swim: [], bike: [], run: [] };
  for (const [weekStart, sportWeeks] of byStart) {
    const layout = layoutTriWeek(sessionsFromPlannedWeeks(sportWeeks), schedule);
    for (const d of TRI_DISCIPLINES) {
      const wk = sportWeeks[d];
      if (!wk) continue;
      const days: PlannedDay[] = [];
      for (let dow = 0; dow < 7; dow++) days.push(restDay(dateForDow(weekStart, dow), dow));
      for (const placed of layout.days) {
        for (const s of placed.sessions) {
          if (s.discipline !== d || !s.source) continue;
          days[placed.dow] = { ...s.source, dow: placed.dow, day: dateForDow(weekStart, placed.dow) };
        }
      }
      out[d].push({ ...wk, days });
    }
  }
  for (const d of TRI_DISCIPLINES) out[d].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  return out;
}
