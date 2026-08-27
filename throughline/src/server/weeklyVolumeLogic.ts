/**
 * PURE weekly-time aggregation (no DB) — the one training-volume currency that
 * works ACROSS sports is time. You can't add swim metres to bike miles to run
 * miles, but you can add the hours. This buckets each activity's minutes into
 * its week by sport, for the multisport volume view.
 */
export const SPORT_ORDER = ['swim', 'bike', 'run', 'strength'] as const;

export interface WeekTime {
  weekStart: string;
  /** Minutes per sport this week (only sports with time appear). */
  bySport: Record<string, number>;
}

export function buildTimeByWeek(
  rows: { weekStart: string; sport: string; minutes: number }[],
  weekStarts: string[],
): { byWeek: WeekTime[]; sports: string[] } {
  const index = new Map<string, Record<string, number>>();
  for (const ws of weekStarts) index.set(ws, {});
  const present = new Set<string>();

  for (const r of rows) {
    if (!(r.minutes > 0)) continue;
    const bucket = index.get(r.weekStart);
    if (!bucket) continue; // outside the window
    bucket[r.sport] = (bucket[r.sport] ?? 0) + r.minutes;
    present.add(r.sport);
  }

  const byWeek = weekStarts.map((ws) => ({ weekStart: ws, bySport: index.get(ws)! }));
  // Canonical sports first (swim → bike → run → strength), then any others.
  const known = SPORT_ORDER.filter((s) => present.has(s)) as string[];
  const extra = [...present].filter((s) => !(SPORT_ORDER as readonly string[]).includes(s)).sort();
  return { byWeek, sports: [...known, ...extra] };
}
