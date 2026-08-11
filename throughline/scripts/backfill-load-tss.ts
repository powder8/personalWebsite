/**
 * L1 backfill — populate the NEW load currency (TSS-equivalent) into the parallel
 * `activities.training_load_tss` + `activities.load_confidence` columns for every
 * activity. NON-DESTRUCTIVE: it never touches `trainingLoad` or anything the PMC
 * currently reads. Nothing user-visible changes; the app keeps reading TRIMP until
 * the later, owner-signed-off cutover (story L2).
 *
 * Idempotent: recomputes and overwrites only the two parallel columns, so it can
 * be re-run safely.
 *
 * SAFETY: runs against whatever DB `getDb()` resolves (local file-backed PGlite in
 * dev when DATABASE_URL is unset). Do NOT point this at production — the prod /
 * replica run is the owner's job.
 *
 *   Local dev (PGlite, dev server NOT running):
 *     DATABASE_URL='' node --import tsx scripts/backfill-load-tss.ts
 *     DATABASE_URL='' node --import tsx scripts/backfill-load-tss.ts --dry-run
 */
import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { activities, athletes, intakeProfiles } from '@/db/schema';
import { getAthleteVdot } from '@/db/paceConfig';
import { getAthleteFtp } from '@/db/powerConfig';
import { resolvePaceZones, type AthletePaceConfig } from '@/engine/plan';
import { gapFromSplits, type GapSplit } from '@/engine/plan/gap';
import { estimateLoadTss, type LoadAnchors, type LoadConfidence } from '@/engine/loadCurrencyLogic';
import type { HrParams } from '@/engine/types';

const DRY_RUN = process.argv.includes('--dry-run');

/** Threshold pace (sec/km) from the athlete's VDOT anchor, via the pace-zone model. */
async function resolveThresholdPace(
  db: Awaited<ReturnType<typeof getDb>>,
  athleteId: string,
): Promise<number | null> {
  const vdot = await getAthleteVdot(db, athleteId);
  if (vdot == null) return null;
  try {
    return resolvePaceZones({ vdot } as AthletePaceConfig).thresholdSecPerKm;
  } catch {
    return null;
  }
}

/**
 * HR params for hrTSS. avgHr is per-activity; max/resting/sex come from the
 * athlete + intake. Resting HR falls back to a nominal 50 when unknown — the
 * hrTSS rescale is threshold-relative, so it's insensitive to small resting-HR
 * error. Returns null when we can't form a usable reserve.
 */
function resolveHrParams(
  athleteSex: string | null,
  maxHr: number | null,
): HrParams | null {
  const restingHr = 50;
  const max = maxHr ?? 190;
  if (max - restingHr <= 0) return null;
  const sex: 'M' | 'F' | undefined =
    athleteSex === 'female' ? 'F' : athleteSex === 'male' ? 'M' : undefined;
  return { restingHr, maxHr: max, sex };
}

async function main() {
  const db = await getDb();
  const roster = await db.select().from(athletes);
  console.log(`Backfill load currency (TSS-equivalent) — ${roster.length} athletes${DRY_RUN ? '  [DRY RUN]' : ''}\n`);

  let totalRows = 0;
  let totalWritten = 0;
  const confidenceTally: Record<LoadConfidence, number> = {
    power: 0, pace: 0, css: 0, hr: 0, estimated: 0,
  };

  for (const a of roster) {
    const rows = await db
      .select({
        id: activities.id,
        sport: activities.sport,
        startTime: activities.startTime,
        durationSeconds: activities.durationSeconds,
        distanceMeters: activities.distanceMeters,
        avgPaceSecPerKm: activities.avgPaceSecPerKm,
        avgHr: activities.avgHr,
        maxHr: activities.maxHr,
        elevationGainMeters: activities.elevationGainMeters,
        splits: activities.splits,
      })
      .from(activities)
      .where(eq(activities.athleteId, a.id))
      .orderBy(asc(activities.startTime));

    if (rows.length === 0) continue;

    // --- resolve this athlete's anchors once (v1: current anchor applied to all
    // history — a documented approximation; the PMC is relative). Swim has no CSS
    // anchor source yet, so swim activities fall to the estimated tier. ---
    const thresholdPaceSecPerKm = await resolveThresholdPace(db, a.id);
    const ftpWatts = await getAthleteFtp(db, a.id);
    // LTHR, if configured on the power side, sharpens the hrTSS conversion constant.
    const [intake] = await db
      .select()
      .from(intakeProfiles)
      .where(eq(intakeProfiles.athleteId, a.id))
      .limit(1);
    const lthrBpm = (intake?.answers as { lthrBpm?: number } | null)?.lthrBpm ?? null;

    const perAthlete: Record<LoadConfidence, number> = { power: 0, pace: 0, css: 0, hr: 0, estimated: 0 };
    let written = 0;

    for (const r of rows) {
      const dur = r.durationSeconds ?? 0;
      // GAP from splits when available, so hilly runs score honestly.
      const gap = r.sport === 'run' ? gapFromSplits(r.splits as GapSplit[] | null) : null;

      const anchors: LoadAnchors = {
        thresholdPaceSecPerKm,
        ftpWatts,
        lthrBpm,
        hr: resolveHrParams(a.sex, r.maxHr),
        // cssMetersPerSec: no swim-CSS anchor source yet (future swimConfig) → swim → estimated.
      };

      const result = estimateLoadTss(
        {
          sport: r.sport,
          durationSeconds: dur,
          avgHr: r.avgHr,
          distanceMeters: r.distanceMeters,
          avgPaceSecPerKm: r.avgPaceSecPerKm,
          gapSecPerKm: gap?.gapSecPerKm ?? null,
        },
        anchors,
      );

      perAthlete[result.confidence]++;
      confidenceTally[result.confidence]++;
      totalRows++;

      if (!DRY_RUN) {
        await db
          .update(activities)
          .set({
            trainingLoadTss: Math.round(result.load * 100) / 100,
            loadConfidence: result.confidence,
          })
          .where(eq(activities.id, r.id));
      }
      written++;
    }

    totalWritten += written;
    const tiers = (Object.keys(perAthlete) as LoadConfidence[])
      .filter((k) => perAthlete[k] > 0)
      .map((k) => `${k}:${perAthlete[k]}`)
      .join(' ');
    console.log(
      `  ${a.fullName.padEnd(22)} ${String(rows.length).padStart(4)} acts  ` +
        `anchors[pace=${thresholdPaceSecPerKm ? thresholdPaceSecPerKm.toFixed(0) + 's/km' : '—'} ` +
        `ftp=${ftpWatts ?? '—'} lthr=${lthrBpm ?? '—'}]  →  ${tiers}`,
    );
  }

  console.log(
    `\n${DRY_RUN ? 'Would write' : 'Wrote'} ${totalWritten}/${totalRows} rows.  ` +
      `Confidence mix: ${(Object.keys(confidenceTally) as LoadConfidence[])
        .map((k) => `${k}=${confidenceTally[k]}`)
        .join('  ')}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
