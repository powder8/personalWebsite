/**
 * Training-block read model: collapse the published week-by-week plan into the
 * periodized blocks the engine built (base → build → peak → taper), with races
 * pinned onto the timeline and a "you are here" marker. This is the macro view
 * of a season — the thing that shows an athlete HOW the plan pushes fitness,
 * not just what's on today.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { plans, races } from '@/db/schema';

export interface BlockRace {
  name: string;
  date: string;
  priority: string; // goal | tune_up | training | other
  purpose: string | null;
}

export interface TrainingBlock {
  phase: string; // base | build | peak | taper | …
  startDay: string;
  endDay: string;
  weeks: number;
  /** Weekly mileage range across the block (rounded), for the "pushes fitness" story. */
  milesMin: number | null;
  milesMax: number | null;
  current: boolean;
  races: BlockRace[];
}

export interface SeasonTimeline {
  blocks: TrainingBlock[];
  totalWeeks: number;
  /** 1-based week of the season the athlete is in (null if outside the plan). */
  currentWeek: number | null;
  startDay: string;
  endDay: string;
  /** 0..1 progress through the season as of today. */
  progress: number;
}

interface WeekRow {
  weekStart: string;
  weekEnd: string;
  phase: string | null;
  weeklyTargetMeters: number | null;
}
interface RaceRow {
  name: string;
  date: string;
  priority: string;
  purpose: string | null;
}

const MI = 1609.344;

/** Pure grouping: consecutive same-phase weeks → blocks; races pinned by date. */
export function buildTimeline(weeks: WeekRow[], raceRows: RaceRow[], today: string): SeasonTimeline | null {
  if (!weeks.length) return null;
  const blocks: TrainingBlock[] = [];

  for (const w of weeks) {
    const phase = w.phase ?? 'train';
    const miles = w.weeklyTargetMeters != null ? Math.round(w.weeklyTargetMeters / MI) : null;
    const last = blocks[blocks.length - 1];
    if (last && last.phase === phase) {
      last.endDay = w.weekEnd;
      last.weeks += 1;
      if (miles != null) {
        last.milesMin = last.milesMin == null ? miles : Math.min(last.milesMin, miles);
        last.milesMax = last.milesMax == null ? miles : Math.max(last.milesMax, miles);
      }
    } else {
      blocks.push({
        phase,
        startDay: w.weekStart,
        endDay: w.weekEnd,
        weeks: 1,
        milesMin: miles,
        milesMax: miles,
        current: false,
        races: [],
      });
    }
  }

  const startDay = blocks[0].startDay;
  const endDay = blocks[blocks.length - 1].endDay;
  for (const r of raceRows) {
    if (r.date < startDay || r.date > endDay) continue;
    const b = blocks.find((bl) => r.date >= bl.startDay && r.date <= bl.endDay);
    if (b) b.races.push({ name: r.name, date: r.date, priority: r.priority, purpose: r.purpose });
  }

  let currentWeek: number | null = null;
  weeks.forEach((w, i) => {
    if (today >= w.weekStart && today <= w.weekEnd) currentWeek = i + 1;
  });
  for (const b of blocks) b.current = today >= b.startDay && today <= b.endDay;

  const span = Math.max(1, Date.parse(endDay) - Date.parse(startDay));
  const progress = Math.min(1, Math.max(0, (Date.parse(today) - Date.parse(startDay)) / span));

  return { blocks, totalWeeks: weeks.length, currentWeek, startDay, endDay, progress };
}

/** Load the published season for an athlete and build the block timeline. */
export async function getSeasonTimeline(db: DB, athleteId: string, today: string): Promise<SeasonTimeline | null> {
  const weekRows = await db
    .select({
      weekStart: plans.weekStart,
      weekEnd: plans.weekEnd,
      phase: plans.phase,
      weeklyTargetMeters: plans.weeklyTargetMeters,
    })
    .from(plans)
    .where(and(eq(plans.athleteId, athleteId), eq(plans.status, 'published')))
    .orderBy(asc(plans.weekStart));

  const raceRows = await db
    .select({ name: races.name, date: races.date, priority: races.priority, purpose: races.purpose })
    .from(races)
    .where(eq(races.athleteId, athleteId));

  return buildTimeline(weekRows, raceRows, today);
}
