import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAthletePortal } from '@/server/portal';
import { Card } from '@/components/ui';
import { secPerKmToMinPerMile } from '@/engine/plan';
import { CheckInForm } from '@/components/CheckInForm';
import { TrainingChat } from '@/components/TrainingChat';
import { chatConfigured } from '@/server/chat';
import { SyncButton } from '@/components/SyncButton';
import { GoalSetup } from '@/components/GoalSetup';
import { getAthleteVdot } from '@/db/paceConfig';
import { TrainingCalendar } from '@/components/TrainingCalendar';
import { getTrainingCalendar } from '@/server/trainingCalendar';
import { NextStepBanner } from '@/components/NextStepBanner';
import { getAdaptationState, easeBackDirectives } from '@/server/adaptation';
import { decideNextStep } from '@/server/nextStepLogic';
import { ConsistencyStrip } from '@/components/ConsistencyStrip';
import { getConsistency } from '@/server/consistency';
import { RunFeedbackCard } from '@/components/RunFeedbackCard';
import { getLatestRunFeedback } from '@/server/runFeedback';
import { RunDebriefCard } from '@/components/RunDebriefCard';
import { getRunDebrief } from '@/server/runDebrief';
import { RecoveryCard } from '@/components/RecoveryCard';
import { getRecoveryInsights, persistReadiness } from '@/server/recovery';
import { ReadinessCheck } from '@/components/ReadinessCheck';
import { decideReadinessGate } from '@/server/readinessGate';
import { GoalTrackerHero } from '@/components/GoalTrackerHero';
import { getGoalTracker } from '@/server/goalTracker';
import { BottomNav } from '@/components/BottomNav';
import { getRecentCrossTraining } from '@/server/weeklyVolume';
import { getDb } from '@/db';
import { ensureSeasonCoverage } from '@/server/seasonCoverage';
import { todayISO } from '@/server/console';
import { SESSION_TERRAIN } from '@/components/WeekStrip';

export const dynamic = 'force-dynamic';

function pace(sec: number | null): string {
  return sec == null ? '' : `${secPerKmToMinPerMile(sec)}/mi`;
}

export default async function PortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ import?: string }>;
}) {
  const { id } = await params;
  const { import: importFlag } = await searchParams;
  const autoImportStrava = importFlag === '1';

  const db = await getDb();
  try {
    await ensureSeasonCoverage(db, id, todayISO());
  } catch {
    /* coverage is best-effort */
  }

  const portal = await getAthletePortal(id);
  if (!portal) notFound();

  const [hasAnchorRaw, adaptation, consistency, latestRun, calendar, crossTraining, recovery] = await Promise.all([
    getAthleteVdot(db, id),
    getAdaptationState(id, portal.today),
    getConsistency(id, portal.today),
    getLatestRunFeedback(id, portal.today),
    getTrainingCalendar(id, portal.today),
    getRecentCrossTraining(db, id, portal.today),
    getRecoveryInsights(db, id, portal.today),
  ]);

  // Live readiness computed from wearable data takes precedence over any stored
  // row; persist it best-effort so the autopilot, console, and chat see it too.
  if (recovery.readiness) {
    try {
      await persistReadiness(db, id, recovery.readiness);
    } catch {
      /* best-effort */
    }
  }

  const hasAnchor = hasAnchorRaw != null;
  const latestDebrief = latestRun ? await getRunDebrief(id, latestRun.activityId, { narrate: false }) : null;

  const {
    athlete,
    today,
    todaySession,
    goalRace,
    checkedInToday,
    recentCheckIns,
    strava,
  } = portal;

  const firstName = athlete.fullName.split(' ')[0];
  const todayCheckIn = recentCheckIns.find((c) => c.day === today) ?? null;
  const goalDone = !!goalRace.name && goalRace.daysAway != null && goalRace.daysAway < 0;
  const needsGoal = !goalRace.name || goalDone;
  const ranToday = latestRun?.day === today || adaptation?.layoffDays === 0;

  // Goal tracker hook — the "where do I stand?" verdict. Only when there's a
  // live goal to track (a finished/absent goal is handled by the goal-setup CTA).
  const goalTracker = needsGoal ? null : await getGoalTracker(db, id, today, consistency);

  const nextStep = decideNextStep({
    firstName,
    hasAnchor,
    hasGoal: !!goalRace.name,
    goalDone,
    layoffDays: adaptation?.layoffDays ?? null,
    easeBackAvailable: !!adaptation?.easeBack,
    easeBackApplied: !!adaptation?.easeBackApplied,
    ranToday,
    today: todaySession
      ? {
          sessionType: todaySession.sessionType,
          miles: todaySession.distanceMeters != null ? todaySession.distanceMeters / 1609.344 : 0,
          paceLabel:
            todaySession.paceFastSecPerKm != null
              ? `${pace(todaySession.paceFastSecPerKm)}–${pace(todaySession.paceSlowSecPerKm)}`
              : null,
          eased: todaySession.adjustments.length > 0,
        }
      : null,
    readinessBand: recovery.readiness?.band ?? null,
    coachingMode: athlete.coachingMode,
  });
  const easeDirectives = adaptation ? easeBackDirectives(adaptation, today) : [];

  // Autonomous mode: don't ease on wearable data alone — ask how they feel, then
  // recommend easing (they agree) or keeping the session (they feel good).
  const readinessGate = decideReadinessGate({
    coachingMode: athlete.coachingMode,
    band: recovery.readiness?.band ?? null,
    sessionType: todaySession?.sessionType ?? null,
    ranToday,
    isRestDay: !todaySession || todaySession.sessionType === 'rest' || (todaySession.distanceMeters ?? 0) <= 0,
    checkedInToday,
    energy: todayCheckIn?.energy ?? null,
    soreness: todayCheckIn?.soreness ?? null,
  });

  // The specific workout to render inline in the next-step card on a training
  // day (segments carry the reps/paces so "threshold" reads as a real session).
  const isRestToday = !todaySession || todaySession.sessionType === 'rest' || (todaySession.distanceMeters ?? 0) <= 0;
  const sessionDetail =
    todaySession && !ranToday && !isRestToday
      ? {
          paceLabel:
            todaySession.paceFastSecPerKm != null
              ? `${pace(todaySession.paceFastSecPerKm)}–${pace(todaySession.paceSlowSecPerKm)}`
              : null,
          segments: todaySession.segments ?? [],
          description: todaySession.description ?? null,
          terrain: SESSION_TERRAIN[todaySession.sessionType] ?? null,
          adjustments: todaySession.adjustments,
        }
      : null;
  const loggedToday =
    ranToday && latestRun?.day === today ? { miles: latestRun.dayMiles, runCount: latestRun.runCount } : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-20 sm:pb-4">
      <p className="px-1 pt-1 text-sm text-slate-400">Hi {firstName} 👋 · {today}</p>

      {/* ── GOAL TRACKER — where do I stand? (the hook) ──────────────────── */}
      {goalTracker && <GoalTrackerHero tracker={goalTracker} athleteId={athlete.id} />}

      {/* ── TODAY / NEXT STEP — the one thing to do now, with the specific workout ── */}
      <NextStepBanner
        step={nextStep}
        athleteId={athlete.id}
        easeDirectives={easeDirectives}
        latestActivityId={latestRun?.activityId ?? null}
        session={sessionDetail}
        loggedToday={loggedToday}
      />

      {/* Autonomous readiness gate: ask before easing, then recommend. */}
      {readinessGate.kind === 'ask' && (
        <ReadinessCheck athleteId={athlete.id} day={today} title={readinessGate.title} body={readinessGate.body} />
      )}
      {(readinessGate.kind === 'ease' || readinessGate.kind === 'hold') && (
        <div
          className={`rounded-3xl p-5 shadow-lg ring-1 ring-inset ${
            readinessGate.kind === 'ease'
              ? 'bg-amber-400/10 ring-amber-400/25'
              : 'bg-emerald-400/10 ring-emerald-400/25'
          }`}
        >
          <h2
            className={`flex items-center gap-2 text-base font-bold tracking-tight ${
              readinessGate.kind === 'ease' ? 'text-amber-200' : 'text-emerald-200'
            }`}
          >
            <span aria-hidden>{readinessGate.kind === 'ease' ? '🔻' : '👍'}</span>
            <span>{readinessGate.title}</span>
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{readinessGate.body}</p>
        </div>
      )}

      {/* Recovery & body — wearable-driven readiness (Whoop) */}
      {recovery.hasData && <RecoveryCard snapshot={recovery.snapshot} readiness={recovery.readiness} />}

      {/* Goal setup — shown when there's no live goal */}
      <div id="goal-setup" className="scroll-mt-4" />
      {needsGoal && (
        <Card
          title={goalDone ? "What's next?" : 'What are you training for?'}
          className="border-lime-400/30 ring-1 ring-inset ring-lime-400/30"
        >
          {goalDone && (
            <p className="mb-3 text-sm text-slate-600">
              Congrats on {goalRace.name}! The fitness you built is a launchpad — momentum fades fast if it
              doesn't point at something. Pick the next goal and we'll build the plan.
            </p>
          )}
          <GoalSetup athleteId={athlete.id} hasAnchor={hasAnchor} hasGoal={!!goalRace.name} startOpen />
        </Card>
      )}

      {/* Latest run debrief — cross-training folded in at the bottom */}
      {latestDebrief ? (
        <Link href={`/me/${athlete.id}/runs/${latestRun!.activityId}`} className="block transition hover:opacity-95">
          <RunDebriefCard
            debrief={latestDebrief}
            daysAgo={latestRun!.daysAgo}
            dayMiles={latestRun!.dayMiles}
            crossTraining={crossTraining.sessions > 0 ? crossTraining : null}
          />
        </Link>
      ) : (
        latestRun && (
          <RunFeedbackCard feedback={latestRun.feedback} href={`/me/${athlete.id}/runs/${latestRun.activityId}`} />
        )
      )}

      {/* Nothing logged at all → constructive nudge */}
      {!latestRun && crossTraining.sessions === 0 && !calendar.hasActuals && (
        <Card title="No activity logged yet">
          <p className="text-sm text-slate-600">
            Your runs and rides show up here automatically once Strava is connected — with a coach's debrief on
            every run.
          </p>
          <Link href={`/me/${athlete.id}/settings`} className="mt-3 inline-block text-sm font-medium text-sky-300 hover:underline">
            Connect Strava in settings →
          </Link>
        </Card>
      )}

      {/* Consistency / streak */}
      {consistency?.show && <ConsistencyStrip stats={consistency} />}

      {/* ── TRAINING CALENDAR ────────────────────────────────────────────── */}
      <div id="training" className="scroll-mt-4" />
      <Card title="Planned vs actual" action={strava.connected ? <SyncButton athleteId={athlete.id} /> : undefined}>
        {calendar.weeks.length > 0 ? (
          <TrainingCalendar weeks={calendar.weeks} today={today} athleteId={athlete.id} />
        ) : (
          <p className="text-sm text-slate-500">
            No published plan yet — set a goal above and your calendar fills in.
          </p>
        )}
      </Card>

      {/* ── CHAT ─────────────────────────────────────────────────────────── */}
      <div id="chat" className="scroll-mt-4" />
      <Card title="Your coach, on demand">
        <TrainingChat athleteId={athlete.id} configured={chatConfigured()} />
      </Card>

      <BottomNav athleteId={athlete.id} />
    </div>
  );
}
