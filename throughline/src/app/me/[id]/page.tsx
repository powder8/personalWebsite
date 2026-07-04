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
import { SegmentList } from '@/components/SegmentList';
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
import { SESSION_COLOR, SESSION_LABEL, SESSION_TERRAIN } from '@/components/WeekStrip';

export const dynamic = 'force-dynamic';

function pace(sec: number | null): string {
  return sec == null ? '' : `${secPerKmToMinPerMile(sec)}/mi`;
}
function miles(m: number | null): string {
  return m == null || m <= 0 ? '—' : (m / 1609.344).toFixed(1);
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
    readiness: storedReadiness,
    todaySession,
    thisWeek,
    goalRace,
    checkedInToday,
    recentCheckIns,
    strava,
  } = portal;

  // Prefer the freshly-computed wearable readiness; fall back to the stored row.
  const readiness = recovery.readiness
    ? { band: recovery.readiness.band, sentence: recovery.readiness.sentence }
    : storedReadiness;

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

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-20 sm:pb-4">
      {/* ── GOAL TRACKER — where do I stand? (the hook) ──────────────────── */}
      {goalTracker && <GoalTrackerHero tracker={goalTracker} athleteId={athlete.id} />}

      {/* ── NEXT STEP ────────────────────────────────────────────────────── */}
      <NextStepBanner
        step={nextStep}
        athleteId={athlete.id}
        easeDirectives={easeDirectives}
        latestActivityId={latestRun?.activityId ?? null}
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

      {/* ── TODAY ────────────────────────────────────────────────────────── */}
      {/* When the goal tracker is present it owns the goal identity + countdown,
          so this block slims to the greeting + today's session. Otherwise it
          carries the full goal header (no-goal / just-raced states). */}
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-6 text-white shadow-lg">
        {goalTracker ? (
          <p className="text-sm text-slate-400">Hi {firstName} 👋 · {today}</p>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-slate-400">Hi {firstName} 👋 · {today}</p>
              {goalDone ? (
                <>
                  <h1 className="mt-2 truncate text-2xl font-bold tracking-tight">You raced {goalRace.name}! 🎉</h1>
                  <p className="mt-0.5 text-sm text-lime-300">That chapter's done — time to pick the next one.</p>
                </>
              ) : goalRace.name ? (
                <>
                  <h1 className="mt-2 truncate text-2xl font-bold tracking-tight">{goalRace.name}</h1>
                  <p className="mt-0.5 text-sm text-slate-400">{goalRace.date}</p>
                </>
              ) : (
                <>
                  <h1 className="mt-2 text-2xl font-bold tracking-tight">What are you chasing?</h1>
                  <p className="mt-0.5 text-sm text-slate-400">
                    Training works when it points somewhere. Set a goal below and we'll build your plan.
                  </p>
                </>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {readiness.band && (
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold capitalize text-white/90 ring-1 ring-inset ring-white/15">
                    Readiness: {readiness.band}
                  </span>
                )}
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/90 ring-1 ring-inset ring-white/15">
                  {athlete.coachingMode === 'assisted' ? 'Coach-guided' : 'Auto-coached'}
                </span>
              </div>
            </div>
            {goalRace.daysAway != null && goalRace.daysAway >= 0 && (
              <div className="shrink-0 text-right">
                <div className="text-5xl font-extrabold leading-none tracking-tight text-lime-300 tabular-nums">
                  {goalRace.daysAway}
                </div>
                <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">days to go</div>
              </div>
            )}
          </div>
        )}

        {/* Up today */}
        <div className="mt-5 rounded-2xl bg-white/10 p-4 ring-1 ring-inset ring-white/10">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-lime-300">
            {ranToday ? 'Today' : 'Up today'}
          </div>
          {ranToday ? (
            <div className="mt-1.5 flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-lime-300 text-lg font-bold text-[#0c1018]">
                ✓
              </span>
              <div className="min-w-0">
                <div className="text-lg font-bold leading-tight tracking-tight">Run logged — nice work</div>
                <p className="text-sm text-white/75">
                  {latestRun && latestRun.day === today
                    ? `${latestRun.dayMiles.toFixed(1)} mi${latestRun.runCount > 1 ? ` across ${latestRun.runCount} runs` : ''} logged today.`
                    : 'Logged for today.'}
                </p>
              </div>
            </div>
          ) : todaySession ? (
            <div className="mt-1.5 flex items-center gap-3">
              <span className={`h-9 w-9 shrink-0 rounded-xl ${SESSION_COLOR[todaySession.sessionType] ?? 'bg-slate-400'}`} />
              <div className="min-w-0">
                <div className="text-lg font-bold leading-tight tracking-tight">
                  {SESSION_LABEL[todaySession.sessionType] ?? todaySession.sessionType}
                  {todaySession.distanceMeters != null && todaySession.distanceMeters > 0 && (
                    <span className="ml-2 font-semibold text-white/80">{miles(todaySession.distanceMeters)} mi</span>
                  )}
                </div>
                {todaySession.paceFastSecPerKm != null && (
                  <div className="text-sm tabular-nums text-white/75">
                    {pace(todaySession.paceFastSecPerKm)}–{pace(todaySession.paceSlowSecPerKm)}
                  </div>
                )}
                {todaySession.adjustments.length > 0 && (
                  <div className="mt-1 inline-block rounded bg-amber-300/20 px-1.5 py-0.5 text-[11px] font-medium text-amber-200">
                    {todaySession.adjustments.join('; ')}
                  </div>
                )}
                {todaySession.segments?.length ? (
                  <SegmentList segments={todaySession.segments} onDark />
                ) : (
                  todaySession.description && <p className="mt-1 text-xs text-slate-400">{todaySession.description}</p>
                )}
                {SESSION_TERRAIN[todaySession.sessionType] && (
                  <p className="mt-1 text-xs text-slate-400">📍 {SESSION_TERRAIN[todaySession.sessionType]}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-3">
              <span className="h-9 w-9 shrink-0 rounded-xl bg-white/15" />
              <div>
                <div className="text-lg font-bold leading-tight tracking-tight">Rest day</div>
                <p className="text-sm text-slate-400">Recovery is training too.</p>
              </div>
            </div>
          )}
          {/* When the Recovery & body card is present it owns this read, so we
              don't repeat the identical sentence here. */}
          {readiness.sentence && !recovery.hasData && (
            <p className="mt-3 border-t border-white/10 pt-2 text-xs text-slate-400">{readiness.sentence}</p>
          )}
        </div>
      </div>

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
