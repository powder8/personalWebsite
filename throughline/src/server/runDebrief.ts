import 'server-only';
/**
 * Post-run "debrief": gathers the run + that day's wellness, extracts grounded
 * signals (runDebriefLogic), then narrates a warm "what went well / focus next"
 * in the coach's voice. Hybrid: the facts are computed; the LLM only phrases
 * them (grounded, so it can't invent). Falls back to the deterministic
 * narrative when no API key is set.
 */
import Anthropic from '@anthropic-ai/sdk';
import { and, desc, eq, gte, lt, lte } from 'drizzle-orm';
import { getDb } from '@/db';
import { activities, plannedSessions, plans, sleepRecords, checkIns, activityFeedback, runDebriefs } from '@/db/schema';
import { gapFromSplits, type GapSplit } from '@/engine/plan';
import { payloadHash } from '@/lib/hash';
import { buildDebrief, type RunSignal, type DebriefInput } from '@/server/runDebriefLogic';
import type { PlannedRef } from '@/server/runFeedbackLogic';

const MI = 1609.344;

export interface RunDebriefResult {
  headline: string;
  wentWell: string;
  focusNext: string;
  signals: RunSignal[];
  narrated: boolean; // true = LLM-phrased, false = deterministic fallback
}

async function plannedFor(athleteId: string, day: string): Promise<PlannedRef | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      sessionType: plannedSessions.sessionType,
      zone: plannedSessions.zone,
      meters: plannedSessions.targetDistanceMeters,
      fast: plannedSessions.targetPaceFastSecPerKm,
      slow: plannedSessions.targetPaceSlowSecPerKm,
    })
    .from(plannedSessions)
    .innerJoin(plans, eq(plannedSessions.planId, plans.id))
    .where(and(eq(plannedSessions.athleteId, athleteId), eq(plannedSessions.day, day), eq(plans.status, 'published')))
    .limit(1);
  if (!row) return null;
  return {
    sessionType: row.sessionType,
    zone: row.zone,
    miles: row.meters != null ? row.meters / MI : 0,
    paceFastSecPerKm: row.fast,
    paceSlowSecPerKm: row.slow,
  };
}

export interface RunFeedbackInput {
  feel?: 'strong' | 'fine' | 'rough' | null;
  tookBreaks?: boolean;
  surface?: 'road' | 'trail' | 'track' | 'treadmill' | null;
  unwell?: boolean;
  note?: string | null;
}

/** Save the athlete's post-run "how did it feel?" read (one per activity). */
export async function saveRunFeedback(athleteId: string, activityId: string, input: RunFeedbackInput): Promise<void> {
  const db = await getDb();
  const [run] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(eq(activities.id, activityId), eq(activities.athleteId, athleteId)))
    .limit(1);
  if (!run) throw new Error('Run not found.');
  const values = {
    athleteId,
    activityId,
    feel: input.feel ?? null,
    tookBreaks: input.tookBreaks ?? null,
    surface: input.surface ?? null,
    unwell: input.unwell ?? null,
    note: input.note?.trim() || null,
  };
  await db
    .insert(activityFeedback)
    .values(values)
    .onConflictDoUpdate({ target: activityFeedback.activityId, set: { ...values } });
}

/** The athlete's saved post-run read (for prefilling the prompt), if any. */
export async function getRunFeedbackReport(athleteId: string, activityId: string): Promise<RunFeedbackInput | null> {
  const db = await getDb();
  const [r] = await db
    .select()
    .from(activityFeedback)
    .where(and(eq(activityFeedback.athleteId, athleteId), eq(activityFeedback.activityId, activityId)))
    .limit(1);
  if (!r) return null;
  return {
    feel: (r.feel as 'strong' | 'fine' | 'rough' | null) ?? null,
    tookBreaks: r.tookBreaks ?? false,
    surface: (r.surface as 'road' | 'trail' | 'track' | 'treadmill' | null) ?? null,
    unwell: r.unwell ?? false,
    note: r.note ?? null,
  };
}

export async function getRunDebrief(
  athleteId: string,
  activityId: string,
  opts: { narrate?: boolean } = {},
): Promise<RunDebriefResult | null> {
  const narrate = opts.narrate ?? true; // detail page narrates; portal uses deterministic
  const db = await getDb();
  const [run] = await db
    .select()
    .from(activities)
    .where(and(eq(activities.id, activityId), eq(activities.athleteId, athleteId)))
    .limit(1);
  if (!run || run.sport !== 'run' || run.distanceMeters == null || run.distanceMeters < MI * 0.4) return null;

  const day = run.startTime.toISOString().slice(0, 10);
  const planned = await plannedFor(athleteId, day);
  const gap = gapFromSplits(run.splits as GapSplit[] | null);

  // Other runs the same day (warm-up / cool-down around this effort).
  const sameDayRuns = await db
    .select({ distanceMeters: activities.distanceMeters })
    .from(activities)
    .where(
      and(
        eq(activities.athleteId, athleteId),
        eq(activities.sport, 'run'),
        gte(activities.startTime, new Date(`${day}T00:00:00Z`)),
        lte(activities.startTime, new Date(`${day}T23:59:59Z`)),
      ),
    );
  const dayRuns = sameDayRuns.filter((r) => r.distanceMeters != null && r.distanceMeters >= MI * 0.4);
  const dayRunCount = dayRuns.length;
  const dayTotalMiles = Math.round((dayRuns.reduce((a, r) => a + (r.distanceMeters ?? 0), 0) / MI) * 10) / 10;

  // Wellness for the day + a sleep norm from the prior ~3 weeks.
  const [todaySleep] = await db
    .select({ sec: sleepRecords.totalSleepSeconds })
    .from(sleepRecords)
    .where(and(eq(sleepRecords.athleteId, athleteId), eq(sleepRecords.day, day)))
    .limit(1);
  const priorSleep = await db
    .select({ sec: sleepRecords.totalSleepSeconds })
    .from(sleepRecords)
    .where(and(eq(sleepRecords.athleteId, athleteId), lt(sleepRecords.day, day)))
    .orderBy(desc(sleepRecords.day))
    .limit(21);
  const sleepNormHours = priorSleep.length >= 5 ? priorSleep.reduce((a, s) => a + (s.sec ?? 0), 0) / priorSleep.length / 3600 : null;
  const [todayCheck] = await db
    .select({ energy: checkIns.energy, soreness: checkIns.soreness })
    .from(checkIns)
    .where(and(eq(checkIns.athleteId, athleteId), eq(checkIns.day, day)))
    .limit(1);

  // The athlete's own post-run read ("how did it feel?"), if they left one.
  const [report] = await db
    .select()
    .from(activityFeedback)
    .where(eq(activityFeedback.activityId, activityId))
    .limit(1);

  const input: DebriefInput = {
    planned,
    actualMiles: run.distanceMeters / MI,
    actualPaceSecPerKm: run.avgPaceSecPerKm,
    gapSecPerKm: gap?.significant ? gap.gapSecPerKm : null,
    movingSeconds: run.durationSeconds,
    elapsedSeconds: run.elapsedSeconds,
    surface: (run.surface as 'road' | 'trail' | null) ?? null,
    climbFeet: run.elevationGainMeters != null ? Math.round(run.elevationGainMeters * 3.28084) : 0,
    sleepHours: todaySleep?.sec != null ? todaySleep.sec / 3600 : null,
    sleepNormHours: sleepNormHours != null ? Math.round(sleepNormHours * 10) / 10 : null,
    energy: todayCheck?.energy ?? null,
    soreness: todayCheck?.soreness ?? null,
    reportedFeel: (report?.feel as 'strong' | 'fine' | 'rough' | null) ?? null,
    reportedUnwell: report?.unwell ?? false,
    reportedBreaks: report?.tookBreaks ?? false,
    reportedSurface: (report?.surface as 'road' | 'trail' | 'track' | 'treadmill' | null) ?? null,
    dayRunCount,
    dayTotalMiles,
  };

  const debrief = buildDebrief(input);
  const fallback: RunDebriefResult = {
    headline: debrief.headline,
    wentWell: debrief.wentWell.join(' '),
    focusNext: debrief.focusNext.join(' '),
    signals: debrief.signals,
    narrated: false,
  };

  if (!narrate || !process.env.ANTHROPIC_API_KEY || debrief.signals.length === 0) return fallback;

  // Narrate ONCE per distinct set of signals, then reuse. Resubmitting the same
  // feedback yields the same signals → same signature → cached prose (no LLM, no
  // drift). New feedback changes the signals → re-narrate exactly once.
  const signature = payloadHash(JSON.stringify(debrief.signals.map((s) => `${s.polarity}:${s.fact}`)));
  const [cached] = await db.select().from(runDebriefs).where(eq(runDebriefs.activityId, activityId)).limit(1);
  if (cached && cached.signature === signature) {
    return { headline: cached.headline, wentWell: cached.wentWell, focusNext: cached.focusNext, signals: debrief.signals, narrated: true };
  }
  try {
    const narrated = await narrateSignals(debrief.signals);
    if (!narrated) return fallback;
    await db
      .insert(runDebriefs)
      .values({ athleteId, activityId, signature, ...narrated })
      .onConflictDoUpdate({
        target: runDebriefs.activityId,
        set: { signature, ...narrated, updatedAt: new Date() },
      });
    return { ...fallback, ...narrated, narrated: true };
  } catch {
    return fallback; // never fail the page on the LLM
  }
}

/** Phrase the grounded signals into two short coach paragraphs. */
async function narrateSignals(signals: RunSignal[]): Promise<{ headline: string; wentWell: string; focusNext: string } | null> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5';
  const facts = signals.map((s) => `- [${s.polarity}] ${s.fact}`).join('\n');
  const resp = await client.messages.create({
    model,
    max_tokens: 400,
    system:
      'You are the athlete’s running coach writing a short post-run debrief. Use ONLY the facts provided — never invent numbers, paces, or events. Be warm, specific, and encouraging; never guilt-trip; never tell them to "make up" missed miles. ' +
      'Output EXACTLY this format, plain text, no markdown:\nHEADLINE: <≤6 words>\nWENT WELL: <2–3 sentences>\nFOCUS NEXT: <1–2 sentences>',
    messages: [{ role: 'user', content: `Facts about today's run:\n${facts}` }],
  });
  const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n');
  const grab = (label: string) => {
    const m = text.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z ]+:|$)`));
    return m ? m[1].trim() : '';
  };
  const wentWell = grab('WENT WELL');
  const focusNext = grab('FOCUS NEXT');
  if (!wentWell || !focusNext) return null;
  return { headline: grab('HEADLINE') || 'Run debrief', wentWell, focusNext };
}
