/**
 * Activity classifier — the network + DB half of activityJudgmentLogic.
 *
 * Runs best-effort after a sync: judges activities that haven't been judged
 * yet and stores the model's answer on the row. SHADOW MODE — `sport` is never
 * changed. If TypeSafe is unconfigured or unreachable, this quietly does
 * nothing; the app never depends on it.
 */
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { TypeSafeClient, AuthenticationError, TypeSafeError } from '@typesafe-ai/sdk';
import type { DB } from '@/db';
import { activities } from '@/db/schema';
import {
  buildState,
  disagreements,
  QUESTIONS,
  type ActivityFacts,
  type ActivityJudgment,
  type Disagreement,
  type JudgedSport,
} from '@/server/activityJudgmentLogic';

export function typesafeConfigured(): boolean {
  return !!process.env.TYPESAFE_API_KEY;
}

/** The judgment call itself, injectable so tests never touch the network. */
export type Judge = (facts: ActivityFacts) => Promise<ActivityJudgment>;

export function makeJudge(client = new TypeSafeClient({ timeout: 8000 })): Judge {
  return async (facts) => {
    const { answers } = await client.systemOne({ state: buildState(facts), questions: QUESTIONS });
    return {
      sport: answers.sport.choice as JudgedSport,
      confidence: answers.sport.confidence,
      probabilities: answers.sport.probabilities as Record<JudgedSport, number>,
      race: answers.race.noul,
      model: 'jev-latest',
      judgedAt: new Date().toISOString(),
    };
  };
}

/** Judge every not-yet-judged activity in the window (bounded per call). */
export async function judgeUnjudgedActivities(
  db: DB,
  athleteId: string,
  opts: { days?: number; limit?: number; judge?: Judge } = {},
): Promise<{ judged: number; skipped: 'unconfigured' | 'auth' | null }> {
  if (!opts.judge && !typesafeConfigured()) return { judged: 0, skipped: 'unconfigured' };
  const judge = opts.judge ?? makeJudge();
  const since = new Date(Date.now() - (opts.days ?? 90) * 86400000);

  const rows = await db
    .select()
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), isNull(activities.judgment), gte(activities.startTime, since)))
    .orderBy(desc(activities.startTime))
    .limit(opts.limit ?? 40);

  let judged = 0;
  for (const a of rows) {
    try {
      const j = await judge({
        name: a.name,
        providerSport: a.sport,
        workoutType: a.workoutType,
        distanceMeters: a.distanceMeters,
        durationSeconds: a.durationSeconds,
        avgHr: a.avgHr,
        maxHr: a.maxHr,
        cadence: a.cadence,
        elevationGainMeters: a.elevationGainMeters,
        surface: a.surface,
      });
      await db.update(activities).set({ judgment: j }).where(eq(activities.id, a.id));
      judged++;
    } catch (e) {
      // A bad key fails every row the same way — stop, don't hammer the API.
      if (e instanceof AuthenticationError) return { judged, skipped: 'auth' };
      if (e instanceof TypeSafeError) continue; // one bad row shouldn't block the rest
      throw e;
    }
  }
  return { judged, skipped: null };
}

export interface JudgedActivityRow {
  activityId: string;
  day: string;
  name: string | null;
  providerSport: string;
  judgment: ActivityJudgment;
  disagreements: Disagreement[];
}

/** Judged activities where the model disagrees with the provider mapping. */
export async function listDisagreements(db: DB, athleteId: string, days = 90): Promise<{ judged: number; rows: JudgedActivityRow[] }> {
  const since = new Date(Date.now() - days * 86400000);
  const rows = await db
    .select()
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), gte(activities.startTime, since)))
    .orderBy(desc(activities.startTime));

  const judgedRows = rows.filter((a) => a.judgment != null);
  const out: JudgedActivityRow[] = [];
  for (const a of judgedRows) {
    const j = a.judgment as ActivityJudgment;
    const d = disagreements(a.sport, a.workoutType, j);
    if (d.length === 0) continue;
    out.push({
      activityId: a.id,
      day: a.startTime.toISOString().slice(0, 10),
      name: a.name,
      providerSport: a.sport,
      judgment: j,
      disagreements: d,
    });
  }
  return { judged: judgedRows.length, rows: out };
}
