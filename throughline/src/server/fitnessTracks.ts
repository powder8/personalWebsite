import 'server-only';
/**
 * Multi-track fitness (PMC) read model — the cross-sport transfer view (spec L3).
 *
 * Sits directly on top of the single-series PMC (`server/fitness.ts`) and reuses
 * the SAME currency selector (`selectDailyLoad`, flag-gated trimp/tss) so the two
 * never diverge. For each target discipline it produces three parallel Banister
 * tracks — CENTRAL (transferable aerobic), SPECIFIC (economy), DURABILITY (impact)
 * — via `engine/transferLogic.ts`.
 *
 * Runner-neutral by construction: for an athlete with only run activities, the
 * run→run transfer coefficients are all 1.0, so `central:run == specific:run ==
 * durability:run ==` today's single PMC. The two READS this module exposes then
 * collapse to the legacy behavior:
 *   • aerobic capacity  → CENTRAL track  (bike/pool hours legitimately raise it)
 *   • run-volume safety → DURABILITY track (never central — the injury guardrail)
 * See docs/multisport/load-currency-transfer-spec.md §3.3–§3.4.
 */
import { asc, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { getDb } from '@/db';
import { activities, fitnessFatigueStates } from '@/db/schema';
import { selectDailyLoad, NO_ANCHORS } from '@/engine/loadSelectLogic';
import { getLoadCurrency, resolveAthleteLoadAnchors } from '@/db/loadCurrencyConfig';
import {
  computeFitnessTracks,
  aerobicCapacity,
  runVolumeSafety,
  fromDbSport,
  trackId,
  TRACK_COMPONENTS,
  type Discipline,
  type FitnessTracks,
  type RunVolumeSafety,
  type TrackActivity,
} from '@/engine/transferLogic';

const ASSUMED_EASY_SEC_PER_KM = 330; // mirrors server/fitness.ts

function activityDuration(a: {
  durationSeconds: number | null;
  distanceMeters: number | null;
  avgPaceSecPerKm: number | null;
}): number {
  if (a.durationSeconds != null && a.durationSeconds > 0) return a.durationSeconds;
  const km = (a.distanceMeters ?? 0) / 1000;
  if (km <= 0) return 0;
  return km * (a.avgPaceSecPerKm ?? ASSUMED_EASY_SEC_PER_KM);
}

export interface FitnessTracksResult {
  tracks: FitnessTracks; // full series per track (ascending)
  /** CENTRAL-track "today" — the aerobic-capacity read. */
  aerobicCapacity: { ctl: number; atl: number; tsb: number } | null;
  /** DURABILITY-track read — what caps run-volume prescriptions. */
  runVolumeSafety: RunVolumeSafety;
}

/**
 * Load an athlete's activities as unified-currency daily loads, once. Shared by the
 * series computation and the persist job so both see identical numbers.
 */
async function loadTrackActivities(
  db: DB,
  athleteId: string,
): Promise<{ activities: TrackActivity[]; from: string; to: string } | null> {
  const rows = await db
    .select({
      startTime: activities.startTime,
      sport: activities.sport,
      durationSeconds: activities.durationSeconds,
      distanceMeters: activities.distanceMeters,
      avgPaceSecPerKm: activities.avgPaceSecPerKm,
      avgHr: activities.avgHr,
      maxHr: activities.maxHr,
      trainingLoad: activities.trainingLoad,
      trainingLoadTss: activities.trainingLoadTss,
    })
    .from(activities)
    .where(eq(activities.athleteId, athleteId))
    .orderBy(asc(activities.startTime));
  if (rows.length === 0) return null;

  // Same flag-gated currency swap as the single PMC — DEFAULT 'trimp' is
  // byte-identical to the legacy path.
  const currency = await getLoadCurrency(db);
  const anchors = currency === 'tss' ? await resolveAthleteLoadAnchors(db, athleteId) : NO_ANCHORS;

  const acts: TrackActivity[] = rows.map((r) => {
    const day = r.startTime.toISOString().slice(0, 10);
    const { value } = selectDailyLoad(
      {
        sport: r.sport,
        durationSeconds: activityDuration(r),
        distanceMeters: r.distanceMeters,
        avgHr: r.avgHr,
        avgPaceSecPerKm: r.avgPaceSecPerKm,
        maxHr: r.maxHr,
        trainingLoad: r.trainingLoad,
        trainingLoadTss: r.trainingLoadTss,
      },
      currency,
      anchors,
    );
    return { day, sport: fromDbSport(r.sport), load: value };
  });
  const from = rows[0].startTime.toISOString().slice(0, 10);
  const to = rows[rows.length - 1].startTime.toISOString().slice(0, 10);
  return { activities: acts, from, to };
}

/**
 * The three fitness tracks for one target discipline (default `run`), plus the two
 * consult reads. Returns the last `days` of each series.
 */
export async function getFitnessTracks(
  athleteId: string,
  discipline: Discipline = 'run',
  days = 120,
): Promise<FitnessTracksResult | null> {
  const db = await getDb();
  const loaded = await loadTrackActivities(db, athleteId);
  if (!loaded) return null;

  const full = computeFitnessTracks(loaded.activities, discipline, loaded.from, loaded.to);
  const tracks: FitnessTracks = {
    discipline,
    central: full.central.slice(-days),
    specific: full.specific.slice(-days),
    durability: full.durability.slice(-days),
  };
  return {
    tracks,
    aerobicCapacity: aerobicCapacity(full), // read from the CENTRAL track
    runVolumeSafety: runVolumeSafety(full), // read from the DURABILITY track
  };
}

/**
 * Persist the multi-track series for a discipline into `fitness_fatigue_states`,
 * one row per (day, track). Idempotent per (athlete, day, track). ADDITIVE: it
 * writes `central:<d>` / `specific:<d>` / `durability:<d>` rows and never touches
 * legacy `central` rows. Not on the hot read path — the read models recompute on
 * the fly; this is for callers that want the cached series materialized.
 */
export async function persistFitnessTracks(
  db: DB,
  athleteId: string,
  discipline: Discipline = 'run',
): Promise<number> {
  const loaded = await loadTrackActivities(db, athleteId);
  if (!loaded) return 0;
  const full = computeFitnessTracks(loaded.activities, discipline, loaded.from, loaded.to);
  const seriesByComponent = {
    central: full.central,
    specific: full.specific,
    durability: full.durability,
  } as const;

  const values = TRACK_COMPONENTS.flatMap((component) =>
    seriesByComponent[component].map((p) => ({
      athleteId,
      day: p.day,
      track: trackId(component, discipline),
      ctl: p.ctl,
      atl: p.atl,
      tsb: p.tsb,
    })),
  );
  if (values.length === 0) return 0;

  for (const v of values) {
    await db
      .insert(fitnessFatigueStates)
      .values(v)
      .onConflictDoUpdate({
        target: [fitnessFatigueStates.athleteId, fitnessFatigueStates.day, fitnessFatigueStates.track],
        set: { ctl: v.ctl, atl: v.atl, tsb: v.tsb, computedAt: new Date() },
      });
  }
  return values.length;
}
