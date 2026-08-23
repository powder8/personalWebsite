import 'server-only';
/**
 * Proactive nudge sender. Runs from a cron route a couple of times a day; for
 * each opted-in athlete it builds their state, asks the pure decideNudge() what
 * (if anything) to send, dedupes against today's notifications log (one nudge
 * per athlete per local day), sends the email, and records it.
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { getDb } from '@/db';
import { athletes, activities, notifications } from '@/db/schema';
import { getAthletePortal } from '@/server/portal';
import { getAdaptationState } from '@/server/adaptation';
import { decideNudge, type Nudge } from '@/server/nudgeLogic';
import { getRacePlan } from '@/server/racePlan';
import { getGoalProgress } from '@/server/goalProgress';
import { buildCheckinMessage } from '@/server/progressCheckinLogic';
import { sendNudgeEmail } from '@/lib/email';

/** How often the progress check-in fires (days). */
const CHECKIN_DAYS = 28;

function clock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${m}m`;
}

/**
 * The 4-week progress check-in: due when the last one was >= 28 days ago (or
 * never) and the athlete has a timed goal with a projection + fitness history.
 * Returns a priority nudge so it takes that day's single slot.
 */
async function maybeProgressCheckin(athleteId: string, firstName: string, today: string): Promise<Nudge | null> {
  const db = await getDb();
  const [last] = await db
    .select({ sentAt: notifications.sentAt })
    .from(notifications)
    .where(and(eq(notifications.athleteId, athleteId), eq(notifications.kind, 'progress_checkin')))
    .orderBy(desc(notifications.sentAt))
    .limit(1);
  if (last && (Date.now() - last.sentAt.getTime()) / 86400000 < CHECKIN_DAYS) return null;

  const racePlan = await getRacePlan(db, athleteId, today);
  if (!racePlan?.feasibility || racePlan.goal.targetTimeSeconds == null) return null; // need a timed goal + projection
  const progress = await getGoalProgress(athleteId, today);
  if (!progress) return null; // need fitness history to report a trend

  const projectedSec = racePlan.feasibility.projectedTimeSeconds;
  const goalSec = racePlan.goal.targetTimeSeconds;
  const { subject, body } = buildCheckinMessage({
    firstName,
    distanceLabel: racePlan.goal.distanceLabel,
    projectedLabel: clock(projectedSec),
    goalLabel: clock(goalSec),
    daysToGoal: Math.floor((Date.parse(racePlan.goal.date) - Date.parse(today)) / 86400000),
    fitnessChangePct: progress.changePct,
    fitnessDirection: progress.direction,
    onPace: projectedSec <= goalSec,
  });
  return { kind: 'progress_checkin', subject, body };
}

const QUALITY = new Set(['threshold', 'tempo', 'intervals', 'interval', 'marathon', 'race']);
const SESSION_LABEL: Record<string, string> = {
  recovery: 'recovery jog',
  easy: 'easy run',
  maintenance: 'steady run',
  marathon: 'marathon-pace run',
  long: 'long run',
  tempo: 'tempo run',
  threshold: 'threshold session',
  intervals: 'interval session',
  race: 'race effort',
};

/** Athlete-local hour (0–23) and ISO day for a given IANA timezone. */
function localNow(timezone: string, now: Date): { hour: number; day: string } {
  const tz = timezone || 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = parseInt(get('hour'), 10) % 24;
  return { hour, day: `${get('year')}-${get('month')}-${get('day')}` };
}

export interface NudgeRunResult {
  considered: number;
  sent: { athleteId: string; kind: string; subject: string }[];
  skipped: { athleteId: string; reason: string }[];
}

export async function runNudges(opts: { now?: Date; dryRun?: boolean } = {}): Promise<NudgeRunResult> {
  const db = await getDb();
  const now = opts.now ?? new Date();
  const result: NudgeRunResult = { considered: 0, sent: [], skipped: [] };

  const roster = await db
    .select({ id: athletes.id, name: athletes.fullName, email: athletes.email, tz: athletes.timezone })
    .from(athletes)
    .where(and(eq(athletes.active, true), eq(athletes.notifyEmail, true)));

  for (const a of roster) {
    result.considered++;
    if (!a.email) {
      result.skipped.push({ athleteId: a.id, reason: 'no email' });
      continue;
    }
    const { hour, day } = localNow(a.tz, now);

    // Cheap time gate before any heavier queries: we only ever send in the
    // morning (6–11) or evening (16–21) windows.
    const inWindow = (hour >= 6 && hour <= 11) || (hour >= 16 && hour <= 21);
    if (!inWindow) continue;

    // Dedup: at most one nudge per athlete per local day.
    const [already] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.athleteId, a.id), eq(notifications.localDay, day)))
      .limit(1);
    if (already) {
      result.skipped.push({ athleteId: a.id, reason: 'already nudged today' });
      continue;
    }

    const nudge = await buildAndDecide(a.id, a.name, day, hour);
    if (!nudge) continue;

    if (opts.dryRun) {
      result.sent.push({ athleteId: a.id, kind: nudge.kind, subject: nudge.subject });
      continue;
    }

    try {
      const portalUrl = `${process.env.APP_BASE_URL ?? 'https://throughline.badoo.net'}/me/${a.id}`;
      await sendNudgeEmail({ to: a.email, subject: nudge.subject, body: nudge.body, portalUrl });
      // Insert AFTER send; the unique (athlete, day) index is the dedup backstop.
      await db.insert(notifications).values({ athleteId: a.id, kind: nudge.kind, localDay: day, subject: nudge.subject });
      result.sent.push({ athleteId: a.id, kind: nudge.kind, subject: nudge.subject });
    } catch (err) {
      result.skipped.push({ athleteId: a.id, reason: `send failed: ${(err as Error).message}` });
    }
  }

  return result;
}

/** Assemble the athlete's state from existing read models and decide. */
async function buildAndDecide(
  athleteId: string,
  fullName: string,
  localDay: string,
  localHour: number,
): Promise<Nudge | null> {
  const db = await getDb();
  const portal = await getAthletePortal(athleteId);
  if (!portal) return null;

  // Priority: the ~monthly progress check-in takes the day's single slot when due.
  const checkin = await maybeProgressCheckin(athleteId, fullName.split(' ')[0], portal.today);
  if (checkin) return checkin;

  // Did they already log a run on their local day?
  const [ranToday] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(
      and(
        eq(activities.athleteId, athleteId),
        eq(activities.sport, 'run'),
        gte(activities.startTime, new Date(`${localDay}T00:00:00Z`)),
        lte(activities.startTime, new Date(`${localDay}T23:59:59Z`)),
      ),
    )
    .limit(1);

  const adaptation = await getAdaptationState(athleteId, portal.today);
  const s = portal.todaySession;
  const sessionType = s?.sessionType ?? null;

  return decideNudge({
    firstName: fullName.split(' ')[0],
    localHour,
    todaySession:
      s && sessionType
        ? {
            sessionType,
            miles: s.distanceMeters != null ? s.distanceMeters / 1609.344 : 0,
            isQuality: QUALITY.has(sessionType),
            label: SESSION_LABEL[sessionType] ?? `${sessionType} run`,
          }
        : null,
    loggedToday: !!ranToday,
    streakDays: adaptation?.streakDays ?? 0,
    layoffDays: adaptation?.layoffDays ?? 0,
    goalName: portal.goalRace.name,
    daysToGoal: portal.goalRace.daysAway,
  });
}
