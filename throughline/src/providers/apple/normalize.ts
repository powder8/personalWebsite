/**
 * Apple Health normalizer (PURE). Maps a Health-Auto-Export-style payload — the
 * JSON an on-device iOS exporter POSTs to our ingest endpoint — into the app's
 * NormalizedBatch (HRV / resting HR / sleep). Apple Health has no server API, so
 * this push path is how HealthKit recovery data reaches the backend at all.
 *
 * The exporter's REST shape (stable across its versions in the parts we use):
 *   { data: { metrics: [ { name, units, data: [ { date, qty, ... } ] } ] } }
 * We read only the metrics we understand and ignore the rest, so a payload with
 * extra metrics (steps, energy, …) is fine. Defensive: bad/short payloads yield
 * an empty batch rather than throwing — the endpoint decides how to respond.
 */
import type { NormalizedBatch } from '@/providers/types';

interface MetricPoint {
  date?: string;
  qty?: number;
  // sleep_analysis points carry stage breakdowns (hours), version-dependent keys:
  asleep?: number;
  totalSleep?: number;
  inBed?: number;
  deep?: number;
  rem?: number;
  core?: number;
  light?: number;
  awake?: number;
  value?: number;
}
interface Metric {
  name?: string;
  units?: string;
  data?: MetricPoint[];
}

/** Take the calendar day (YYYY-MM-DD) from an exporter date like
 *  "2026-08-18 07:12:00 +0000" or an ISO string. Returns null if unparseable. */
export function appleDay(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

const hoursToSec = (h: number | undefined): number | null =>
  typeof h === 'number' && h >= 0 ? Math.round(h * 3600) : null;

/** Keep the LAST value seen per day (exporters may send several points/day). */
function lastPerDay<T>(points: MetricPoint[], build: (p: MetricPoint, day: string) => T | null): T[] {
  const byDay = new Map<string, T>();
  for (const p of points) {
    const day = appleDay(p.date);
    if (!day) continue;
    const row = build(p, day);
    if (row) byDay.set(day, row);
  }
  return [...byDay.values()];
}

export function normalizeAppleHealth(payload: unknown): NormalizedBatch {
  const metrics: Metric[] =
    (payload as { data?: { metrics?: Metric[] } })?.data?.metrics ?? [];
  if (!Array.isArray(metrics)) return {};

  const batch: NormalizedBatch = {};

  for (const metric of metrics) {
    const name = metric?.name;
    const points = Array.isArray(metric?.data) ? metric.data : [];
    if (!name || points.length === 0) continue;

    if (name === 'heart_rate_variability') {
      const rows = lastPerDay(points, (p, day) =>
        typeof p.qty === 'number' && p.qty > 0 ? { day, overnightAvgMs: p.qty, metrics: null } : null,
      );
      if (rows.length) batch.hrvRecords = [...(batch.hrvRecords ?? []), ...rows];
    } else if (name === 'resting_heart_rate') {
      const rows = lastPerDay(points, (p, day) =>
        typeof p.qty === 'number' && p.qty > 0 ? { day, restingHr: Math.round(p.qty), metrics: null } : null,
      );
      if (rows.length) batch.restingHrRecords = [...(batch.restingHrRecords ?? []), ...rows];
    } else if (name === 'sleep_analysis') {
      const rows = lastPerDay(points, (p, day) => {
        const deep = hoursToSec(p.deep);
        const rem = hoursToSec(p.rem);
        const light = hoursToSec(p.core ?? p.light);
        const awake = hoursToSec(p.awake);
        // Total asleep: prefer an explicit field, else sum the stages.
        const stageSum = [deep, rem, light].filter((x): x is number => x != null).reduce((a, b) => a + b, 0);
        const total = hoursToSec(p.asleep ?? p.totalSleep ?? p.value) ?? (stageSum > 0 ? stageSum : null);
        if (total == null) return null;
        return {
          day,
          totalSleepSeconds: total,
          deepSeconds: deep,
          remSeconds: rem,
          lightSeconds: light,
          awakeSeconds: awake,
          sleepScore: null,
          metrics: null,
        };
      });
      if (rows.length) batch.sleepRecords = [...(batch.sleepRecords ?? []), ...rows];
    }
  }

  return batch;
}
