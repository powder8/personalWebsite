import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAthletePortal, type PortalSession } from '@/server/portal';
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
import { TodayStack } from '@/components/TodayStack';
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
import { TriGoalTrackerHero } from '@/components/TriGoalTrackerHero';
import { getTriGoalTracker } from '@/server/triGoalTracker';
import { BikeGoalTrackerHero } from '@/components/BikeGoalTrackerHero';
import { getBikeGoalTracker } from '@/server/bikeGoalTracker';
import { CoordinatedBudget } from '@/components/CoordinatedBudget';
import { YourSports } from '@/components/YourSports';
import { getAthleteDisciplines } from '@/server/disciplines';
import { ConnectStrava } from '@/components/ConnectStrava';
import { getGoalTracker } from '@/server/goalTracker';
import { BottomNav } from '@/components/BottomNav';
import { getRecentCrossTraining } from '@/server/weeklyVolume';
import { InjuryPanel } from '@/components/InjuryPanel';
import { getActiveInjury } from '@/server/injury';
import { getDb } from '@/db';
import { ensureSeasonCoverage } from '@/server/seasonCoverage';
import { todayISO } from '@/server/console';
import { SESSION_TERRAIN } from '@/components/WeekStrip';

export const dynamic = 'force-dynamic';

function pace(sec: number | null): string {
  return sec == null ? '' : `${secPerKmToMinPerMile(sec)}/mi`;
}

/** A session is "rest" if it's typed rest or has zero volume in ITS OWN unit —
 * bike days carry duration (miles=0), swim/run carry distance. */
function isRestSession(s: PortalSession | null): boolean {
  if (!s || s.sessionType === 'rest') return true;
  if (s.discipline === 'bike') return (s.durationSeconds ?? 0) <= 0;
  return (s.distanceMeters ?? 0) <= 0; // run + swim volume live in distanceMeters
}

/** Headline target label per discipline: run pace / bike watt band / (swim detail in segments). */
function sessionTargetLabel(s: PortalSession): string | null {
  if (s.discipline === 'bike') {
    return s.targetPowerLoWatts != null && s.targetPowerHiWatts != null
      ? `${Math.round(s.targetPowerLoWatts)}-${Math.round(s.targetPowerHiWatts)} W`
      : null;
  }
  if (s.discipline === 'swim') return null; // per-100m pace lives in the segments
  return s.paceFastSecPerKm != null ? `${pace(s.paceFastSecPerKm)}-${pace(s.paceSlowSecPerKm)}` : null;
}

/** Build the discipline-aware "today" lite for the next-step decision. */
function todayLite(s: PortalSession) {
  return {
    sessionType: s.sessionType,
    discipline: s.discipline,
    miles: s.distanceMeters != null ? s.distanceMeters / 1609.344 : 0,
    durationMinutes: s.durationSeconds != null ? Math.round(s.durationSeconds / 60) : undefined,
    meters: s.discipline === 'swim' ? s.distanceMeters ?? undefined : undefined,
    targetLabel: sessionTargetLabel(s),
    eased: s.adjustments.length > 0,
  };
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

  const [hasAnchorRaw, adaptation, consistency, latestRun, calendar, crossTraining, recovery, injury, disciplines] = await Promise.all([
    getAthleteVdot(db, id),
    getAdaptationState(id, portal.today),
    getConsistency(id, portal.today),
    getLatestRunFeedback(id, portal.today),
    getTrainingCalendar(id, portal.today),
    getRecentCrossTraining(db, id, portal.today),
    getRecoveryInsights(db, id, portal.today),
    getActiveInjury(db, id, portal.today),
    getAthleteDisciplines(db, id),
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

  // Discipline-aware: a cyclist with an FTP anchor (or a swimmer with CSS) has a
  // fitness starting point even without a run VDOT — don't nag them to "set your
  // fitness." hasAnchorRaw (VDOT) still drives run-specific copy in GoalSetup.
  const hasAnchor = hasAnchorRaw != null || disciplines.count > 0;
  const latestDebrief = latestRun ? await getRunDebrief(id, latestRun.activityId, { narrate: false }) : null;

  const {
    athlete,
    today,
    todaySession,
    todaySessions,
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
  // Triathletes with a TIMED goal get the multi-sport tracker (per-leg verdict +
  // binding leg) instead of the single-sport one. Null for everyone else.
  const triGoalTracker = needsGoal ? null : await getTriGoalTracker(db, id, today);
  // Run and bike goals coexist (each scoped to its own discipline), so both
  // trackers can be live at once. A triathlete's combined tracker supersedes both.
  // Each read-model self-nulls when its discipline has no goal, so we just ask for
  // both: getGoalTracker → the run goal, getBikeGoalTracker → the bike goal.
  const bikeGoalTracker = needsGoal || triGoalTracker ? null : await getBikeGoalTracker(db, id, today);

  const nextStep = decideNextStep({
    firstName,
    hasAnchor,
    hasGoal: !!goalRace.name,
    goalDone,
    layoffDays: adaptation?.layoffDays ?? null,
    easeBackAvailable: !!adaptation?.easeBack,
    easeBackApplied: !!adaptation?.easeBackApplied,
    ranToday,
    today: todaySession ? todayLite(todaySession) : null,
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
    isRestDay: isRestSession(todaySession),
    checkedInToday,
    energy: todayCheckIn?.energy ?? null,
    soreness: todayCheckIn?.soreness ?? null,
  });

  // The specific workout to render inline in the next-step card on a training
  // day (segments carry the reps/paces so "threshold" reads as a real session).
  const isRestToday = isRestSession(todaySession);
  const sessionDetail =
    todaySession && !ranToday && !isRestToday
      ? {
          paceLabel: sessionTargetLabel(todaySession),
          segments: todaySession.segments ?? [],
          description: todaySession.description ?? null,
          terrain: SESSION_TERRAIN[todaySession.sessionType] ?? null,
          adjustments: todaySession.adjustments,
        }
      : null;
  const loggedToday =
    ranToday && latestRun?.day === today ? { miles: latestRun.dayMiles, runCount: latestRun.runCount } : null;

  // Multi-sport day: more than one real (non-rest) session to do today. A
  // triathlete gets the stacked view; a single-sport athlete keeps the focal
  // NextStepBanner untouched. Only stack on an actual training day — the
  // lifecycle states (done/rest/ease-back) stay with the banner.
  const trainingSessionsToday = todaySessions.filter((s) => !isRestSession(s));
  const showTodayStack =
    !ranToday && trainingSessionsToday.length > 1 && (nextStep.kind === 'today' || nextStep.kind === 'eased_today');

  // ── SETUP STAGE — no live goal. One job: pick the goal (plus connect the
  // watch). Everything else stays out of the way until training starts.
  if (needsGoal) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pb-20 sm:pb-4">
        <p className="px-1 pt-1 text-sm text-slate-400">Hi {firstName} 👋 · {today}</p>

        <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-6 text-white shadow-lg">
          {goalDone ? (
            <>
              <h1 className="text-2xl font-bold tracking-tight">You raced {goalRace.name}! 🎉</h1>
              <p className="mt-1 text-sm text-white/80">
                Big effort. The fitness you built fades fast if it sits, pick the next goal and we&apos;ll build the
                plan that keeps it.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight">What are you chasing?</h1>
              <p className="mt-1 text-sm text-white/80">
                Pick a race or a goal and I&apos;ll build your week-by-week plan, every run specific, adjusted to how
                your body is responding.
              </p>
            </>
          )}
        </div>

        <div id="goal-setup" className="scroll-mt-4" />
        <Card title={goalDone ? "What's next?" : 'Set your goal'} className="border-lime-400/30 ring-1 ring-inset ring-lime-400/30">
          <GoalSetup athleteId={athlete.id} hasAnchor={hasAnchor} hasGoal={!!goalRace.name} startOpen />
        </Card>

        <YourSports athleteId={athlete.id} disciplines={disciplines} />

        {!strava.connected && (
          <Card title="Connect your watch">
            <p className="mb-3 text-xs text-slate-500">
              Your runs sync automatically, so the plan reacts to what you actually do.
            </p>
            <ConnectStrava athleteId={athlete.id} connected={strava.connected} configured={strava.configured} />
          </Card>
        )}

        {/* Proof of value while they decide: the debrief of their latest run. */}
        {latestDebrief && (
          <Link href={`/me/${athlete.id}/runs/${latestRun!.activityId}`} className="block transition hover:opacity-95">
            <RunDebriefCard debrief={latestDebrief} daysAgo={latestRun!.daysAgo} dayMiles={latestRun!.dayMiles} crossTraining={null} />
          </Link>
        )}

        <BottomNav athleteId={athlete.id} />
      </div>
    );
  }

  // ── TRAINING STAGE — live goal. Order answers the athlete's questions:
  // where do I stand → what do I do today → how is my body handling it →
  // how has training gone → ask the coach.
  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-20 sm:pb-4">
      <p className="px-1 pt-1 text-sm text-slate-400">Hi {firstName} 👋 · {today}</p>

      {/* Where you stand. A triathlete's combined tracker supersedes the rest.
          Otherwise run and bike goals coexist: both trackers stack, under one
          coordinating header so the two commitments read as a single view. */}
      {triGoalTracker ? (
        <TriGoalTrackerHero tracker={triGoalTracker} />
      ) : (
        <>
          {goalTracker && bikeGoalTracker && (
            <p className="px-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              Two goals in play · run + bike
            </p>
          )}
          {goalTracker && <GoalTrackerHero tracker={goalTracker} athleteId={athlete.id} />}
          {bikeGoalTracker && <BikeGoalTrackerHero tracker={bikeGoalTracker} athleteId={athlete.id} />}
          {goalTracker && bikeGoalTracker && (
            <CoordinatedBudget athleteId={athlete.id} currentBudget={athlete.weeklyHoursBudget ?? null} />
          )}
        </>
      )}

      {/* Today, the one thing to do now, with the specific workout. A
          triathlete with several sessions today gets the stacked multi-sport
          view; everyone else gets the single-focal next-step banner. */}
      {showTodayStack ? (
        <TodayStack sessions={trainingSessionsToday} />
      ) : (
        <NextStepBanner
          step={nextStep}
          athleteId={athlete.id}
          easeDirectives={easeDirectives}
          latestActivityId={latestRun?.activityId ?? null}
          session={sessionDetail}
          loggedToday={loggedToday}
        />
      )}

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
          <p className="mt-1.5 text-sm leading-relaxed text-white/80">{readinessGate.body}</p>
        </div>
      )}

      {/* Your sports, always-present path to add a discipline (nav target #sports). */}
      <div id="sports" className="scroll-mt-4" />
      <YourSports athleteId={athlete.id} disciplines={disciplines} hasTriGoal={!!triGoalTracker} />

      {/* ── YOUR BODY ────────────────────────────────────────────────────── */}
      {(recovery.hasData || injury) && (
        <SectionHeader>How your body is responding</SectionHeader>
      )}
      {recovery.hasData && <RecoveryCard snapshot={recovery.snapshot} readiness={recovery.readiness} />}

      {/* Injury: prominent status + resume check when hurt, a quiet report link otherwise. */}
      <InjuryPanel athleteId={athlete.id} injury={injury} />

      {/* ── YOUR TRAINING ────────────────────────────────────────────────── */}
      <SectionHeader>How training is going</SectionHeader>

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

      {/* Nothing logged at all → get the data flowing */}
      {!latestRun && crossTraining.sessions === 0 && !calendar.hasActuals && (
        <Card title="Connect your watch">
          <p className="mb-3 text-xs text-slate-500">
            Your runs and rides show up here automatically, with a coach&apos;s debrief on every run.
          </p>
          <ConnectStrava athleteId={athlete.id} connected={strava.connected} configured={strava.configured} />
        </Card>
      )}

      {consistency?.show && <ConsistencyStrip stats={consistency} />}

      <div id="training" className="scroll-mt-4" />
      <Card title="Planned vs actual" action={strava.connected ? <SyncButton athleteId={athlete.id} /> : undefined}>
        {calendar.weeks.length > 0 ? (
          <TrainingCalendar weeks={calendar.weeks} today={today} athleteId={athlete.id} />
        ) : (
          <p className="text-sm text-slate-500">
            No published plan yet, set a goal above and your calendar fills in.
          </p>
        )}
      </Card>

      {/* Change goal / target time, collapsed; the tracker's CTA lands here. */}
      <div id="goal-setup" className="scroll-mt-4" />
      <Card title="Your goal">
        <p className="mb-2 text-xs text-slate-500">
          {goalRace.name} · {goalRace.date}
          {goalTracker?.cta ? ', add a target time to unlock the on-pace verdict.' : ''}
        </p>
        <GoalSetup athleteId={athlete.id} hasAnchor={hasAnchor} hasGoal />
      </Card>

      {/* ── ASK YOUR COACH ───────────────────────────────────────────────── */}
      <SectionHeader>Ask your coach</SectionHeader>
      <div id="chat" className="scroll-mt-4" />
      <Card title="Your coach, on demand">
        <TrainingChat athleteId={athlete.id} configured={chatConfigured()} />
      </Card>

      <BottomNav athleteId={athlete.id} />
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="px-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</h2>;
}
