/**
 * Shoe mileage tracking. Each pair accrues miles from the runs assigned to it
 * (activities.shoe_id), plus any `initialMiles` carried from before tracking.
 * New runs are auto-stamped with the athlete's active default pair at ingest
 * (see ingest.ts); the athlete can reassign any activity.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { shoes, activities } from '@/db/schema';

const MI = 1609.344;

export interface ShoeInput {
  name: string;
  brand?: string | null;
  startDate?: string | null;
  initialMiles?: number;
  maxMiles?: number;
  isDefault?: boolean;
}

export interface ShoeWithMileage {
  id: string;
  name: string;
  brand: string | null;
  startDate: string | null;
  retiredAt: string | null;
  isDefault: boolean;
  initialMiles: number;
  maxMiles: number;
  miles: number; // initialMiles + miles from assigned runs
  runs: number;
  wearPct: number; // miles / maxMiles, 0..>1
}

/** Add a pair. If marked default (or it's the first active pair), it becomes the sole default. */
export async function addShoe(db: DB, athleteId: string, input: ShoeInput): Promise<string> {
  const name = (input.name ?? '').trim();
  if (!name) throw new Error('Shoe name is required.');
  const makeDefault = input.isDefault ?? false;
  const [row] = await db
    .insert(shoes)
    .values({
      athleteId,
      name,
      brand: input.brand?.trim() || null,
      startDate: input.startDate || null,
      initialMiles: clampNum(input.initialMiles, 0, 0, 5000),
      maxMiles: clampNum(input.maxMiles, 500, 100, 2000),
      isDefault: makeDefault,
    })
    .returning({ id: shoes.id });
  if (makeDefault) await setDefaultShoe(db, athleteId, row.id);
  return row.id;
}

/** Make exactly one pair the athlete's default (clears the flag on the others). */
export async function setDefaultShoe(db: DB, athleteId: string, shoeId: string): Promise<void> {
  await db.update(shoes).set({ isDefault: false }).where(eq(shoes.athleteId, athleteId));
  await db.update(shoes).set({ isDefault: true }).where(and(eq(shoes.id, shoeId), eq(shoes.athleteId, athleteId)));
}

export async function retireShoe(db: DB, athleteId: string, shoeId: string, retiredAt: string): Promise<void> {
  await db
    .update(shoes)
    .set({ retiredAt, isDefault: false })
    .where(and(eq(shoes.id, shoeId), eq(shoes.athleteId, athleteId)));
}

export async function deleteShoe(db: DB, athleteId: string, shoeId: string): Promise<void> {
  // activities.shoe_id FK is ON DELETE SET NULL, so runs aren't lost.
  await db.delete(shoes).where(and(eq(shoes.id, shoeId), eq(shoes.athleteId, athleteId)));
}

/** The athlete's active default pair id (for auto-assigning new runs), or null. */
export async function getDefaultShoeId(db: DB, athleteId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: shoes.id })
    .from(shoes)
    .where(and(eq(shoes.athleteId, athleteId), eq(shoes.isDefault, true), sql`${shoes.retiredAt} is null`))
    .limit(1);
  return row?.id ?? null;
}

/** Reassign a single activity to a pair (or null to clear). Verifies ownership. */
export async function assignActivityShoe(
  db: DB,
  athleteId: string,
  activityId: string,
  shoeId: string | null,
): Promise<void> {
  if (shoeId) {
    const [owns] = await db
      .select({ id: shoes.id })
      .from(shoes)
      .where(and(eq(shoes.id, shoeId), eq(shoes.athleteId, athleteId)))
      .limit(1);
    if (!owns) throw new Error('Shoe not found for this athlete.');
  }
  await db.update(activities).set({ shoeId }).where(and(eq(activities.id, activityId), eq(activities.athleteId, athleteId)));
}

/** All of an athlete's shoes with computed mileage, default pair first, then active, then retired. */
export async function listShoesWithMileage(db: DB, athleteId: string): Promise<ShoeWithMileage[]> {
  const rows = await db.select().from(shoes).where(eq(shoes.athleteId, athleteId));
  if (!rows.length) return [];

  const agg = await db
    .select({
      shoeId: activities.shoeId,
      meters: sql<number>`coalesce(sum(${activities.distanceMeters}), 0)`,
      runs: sql<number>`count(*)`,
    })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), sql`${activities.shoeId} is not null`))
    .groupBy(activities.shoeId);
  const byShoe = new Map(agg.map((a) => [a.shoeId, { meters: Number(a.meters), runs: Number(a.runs) }]));

  const out: ShoeWithMileage[] = rows.map((s) => {
    const a = byShoe.get(s.id) ?? { meters: 0, runs: 0 };
    const miles = Math.round((s.initialMiles + a.meters / MI) * 10) / 10;
    return {
      id: s.id,
      name: s.name,
      brand: s.brand,
      startDate: s.startDate,
      retiredAt: s.retiredAt,
      isDefault: s.isDefault,
      initialMiles: s.initialMiles,
      maxMiles: s.maxMiles,
      miles,
      runs: a.runs,
      wearPct: s.maxMiles > 0 ? miles / s.maxMiles : 0,
    };
  });

  out.sort((x, y) => {
    const rank = (s: ShoeWithMileage) => (s.retiredAt ? 2 : s.isDefault ? 0 : 1);
    return rank(x) - rank(y) || y.miles - x.miles;
  });
  return out;
}

export interface RecentRun {
  id: string;
  day: string;
  name: string | null;
  miles: number;
  shoeId: string | null;
}

/** Recent runs for per-activity shoe reassignment (most recent first). */
export async function listRecentRunsForShoes(db: DB, athleteId: string, limit = 15): Promise<RecentRun[]> {
  const rows = await db
    .select({
      id: activities.id,
      startTime: activities.startTime,
      name: activities.name,
      distanceMeters: activities.distanceMeters,
      shoeId: activities.shoeId,
      sport: activities.sport,
    })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), eq(activities.sport, 'run')))
    .orderBy(sql`${activities.startTime} desc`)
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    day: r.startTime.toISOString().slice(0, 10),
    name: r.name,
    miles: Math.round(((r.distanceMeters ?? 0) / MI) * 10) / 10,
    shoeId: r.shoeId,
  }));
}

function clampNum(v: number | undefined, dflt: number, lo: number, hi: number): number {
  const n = Number.isFinite(v) ? Number(v) : dflt;
  return Math.max(lo, Math.min(hi, n));
}
