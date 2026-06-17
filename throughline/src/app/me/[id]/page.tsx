import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAthletePortal } from '@/server/portal';
import { getTrainingInsights } from '@/server/insights';
import { Card } from '@/components/ui';
import { secPerKmToMinPerMile } from '@/engine/plan';
import { CheckInForm } from '@/components/CheckInForm';
import { AvailabilityForm } from '@/components/AvailabilityForm';
import { CalendarSubscribe } from '@/components/CalendarSubscribe';
import { ConnectStrava } from '@/components/ConnectStrava';
import { TrainingChat } from '@/components/TrainingChat';
import { chatConfigured } from '@/server/chat';
import { CycleTracking } from '@/components/CycleTracking';
import { getCycle, computeCycle } from '@/server/cycle';
import { WeeklyVolumeChart } from '@/components/WeeklyVolumeChart';
import { getTrainingSummary, getRecentCrossTraining } from '@/server/weeklyVolume';
import { CrossTrainingCard } from '@/components/CrossTrainingCard';
import { ShoesPanel } from '@/components/ShoesPanel';
import { listShoesWithMileage, listRecentRunsForShoes } from '@/server/shoes';
import { GoalSetup } from '@/components/GoalSetup';
import { getAthleteVdot } from '@/db/paceConfig';
import { getSeasonTimeline } from '@/server/blocks';
import { getRacePlan } from '@/server/racePlan';
import { RacePlanCard } from '@/components/RacePlanCard';
import { PlanTimeline } from '@/components/PlanTimeline';
import { SESSION_COLOR, SESSION_LABEL, SESSION_TERRAIN } from '@/components/WeekStrip';
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
import { BottomNav } from '@/components/BottomNav';
import { getDb } from '@/db';
import { ensureSeasonCoverage } from '@/server/seasonCoverage';
import { todayISO } from '@/server/console';

export const dynamic = 'force-dynamic';

function pace(sec: number | null): string {
  return sec == null ? '' : `${secPerKmToMinPerMile(sec)}/mi`;
}
function miles(m: number | null): string {
  return m == null || m <= 0 ? '—' : (m / 1609.344).toFixed(1);
}

/**
 * Athlete-facing portal. Reads top-to-bottom as a story: goal (hero) → today →
 * the season's blocks → this week → progress → your inputs → setup.
 */
export default async function PortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ import?: string; strava?: string }>;
}) {
  const { id } = await params;
  const { import: importFlag } = await searchParams;
  const autoImportStrava = importFlag === '1'; // just connected → auto-run import

  // Self-heal coverage before reading: an athlete with a live plan should never
  // see an empty current week (publish the rolling horizon; regenerate if a
  // goaled athlete has no plan at all). Never let this break the page.
  const db = await getDb();
  try {
    await ensureSeasonCoverage(db, id, todayISO());
  } catch {
    /* coverage is best-effort; fall through to whatever exists */
  }

  const portal = await getAthletePortal(id);
  if (!portal) notFound();
  const insights = await getTrainingInsights(id);
  const cycleSettings = await getCycle(db, id);
  const cycleStatus = computeCycle(cycleSettings, portal.today);
  const trainingSummary = await getTrainingSummary(db, id, portal.today, 12);
  const shoes = await listShoesWithMileage(db, id);
  const recentRuns = await listRecentRunsForShoes(db, id, 12);
  const hasAnchor = (await getAthleteVdot(db, id)) != null;
  const timeline = await getSeasonTimeline(db, id, portal.today);
  const racePlan = await getRacePlan(db, id, portal.today);
  const adaptation = await getAdaptationState(id, portal.today);
  const consistency = await getConsistency(id, portal.today);
  const latestRun = await getLatestRunFeedback(id, portal.today);
  // The richer debrief for the latest run, surfaced right on the portal
  // (deterministic here to keep portal loads cheap; the run page narrates).
  const latestDebrief = latestRun ? await getRunDebrief(id, latestRun.activityId, { narrate: false }) : null;
  // Unified planned-vs-actual calendar — the portal centerpiece.
  const calendar = await getTrainingCalendar(id, portal.today);
  // Recent cross-training — credited for aerobic work (not run-pace fitness).
  const crossTraining = await getRecentCrossTraining(db, id, portal.today);

  const {
    athlete,
    today,
    readiness,
    todaySession,
    thisWeek,
    goalRace,
    unavailable,
    checkedInToday,
    recentCheckIns,
    strava,
  } = portal;

  const firstName = athlete.fullName.split(' ')[0];
  const todayCheckIn = recentCheckIns.find((c) => c.day === today) ?? null;
  const currentPhase = timeline?.blocks.find((b) => b.current)?.phase ?? thisWeek?.phase ?? null;
  // Goal lifecycle: no goal → get one set; goal in the past → celebrate + restart.
  const goalDone = !!goalRace.name && goalRace.daysAway != null && goalRace.daysAway < 0;
  const needsGoal = !goalRace.name || goalDone;

  // The single "do this next" guide — one focal action for whatever state.
  const ranToday = latestRun?.day === today || adaptation?.layoffDays === 0;
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
  });
  const easeDirectives = adaptation ? easeBackDirectives(adaptation, today) : [];

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-20 sm:pb-4">
      {/* ── NEXT STEP: the one thing to do right now (any lifecycle state) ── */}
      <NextStepBanner
        step={nextStep}
        athleteId={athlete.id}
        easeDirectives={easeDirectives}
        latestActivityId={latestRun?.activityId ?? null}
      />

      {/* ── HERO: who you are + what you're chasing ─────────────────────── */}
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-6 text-white shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-slate-400">Hi {firstName} 👋 · {today}</p>
            {goalDone ? (
              <>
                <h1 className="mt-2 truncate text-2xl font-bold tracking-tight">You raced {goalRace.name}! 🎉</h1>
                <p className="mt-0.5 text-sm text-lime-300">That chapter’s done — time to pick the next one.</p>
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
                  Training works when it points somewhere. Set a goal below and we’ll build your plan.
                </p>
              </>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {currentPhase && (
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold capitalize text-white/90 ring-1 ring-inset ring-white/15">
                  {currentPhase} block
                </span>
              )}
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

        {/* Up today — inside the hero so goal and action read as one unit */}
        <div className="mt-5 rounded-2xl bg-white/10 p-4 ring-1 ring-inset ring-white/10">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-lime-300">Up today</div>
          {todaySession ? (
            <div className="mt-1.5 flex items-center gap-3">
              <span
                className={`h-9 w-9 shrink-0 rounded-xl ${SESSION_COLOR[todaySession.sessionType] ?? 'bg-slate-400'}`}
              />
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
          {readiness.sentence && <p className="mt-3 border-t border-white/10 pt-2 text-xs text-slate-400">{readiness.sentence}</p>}
        </div>
      </div>

      {/* Goal setup — prominent (and open) whenever there's no LIVE goal:
          never trained with us yet, or the goal race just happened. */}
      <div id="goal-setup" className="scroll-mt-4" />
      {needsGoal && (
        <Card
          title={goalDone ? 'What’s next?' : 'What are you training for?'}
          className="border-lime-400/30 ring-1 ring-inset ring-lime-400/30"
        >
          {goalDone && (
            <p className="mb-3 text-sm text-slate-600">
              Congrats on {goalRace.name}! The fitness you built is a launchpad — momentum fades fast if it doesn’t
              point at something. Another race, a faster time, or just holding your fitness — pick the next goal and
              we’ll build the plan.
            </p>
          )}
          <GoalSetup athleteId={athlete.id} hasAnchor={hasAnchor} hasGoal={!!goalRace.name} startOpen />
        </Card>
      )}

      {/* Your latest run, evaluated — the full debrief, with a link to details */}
      {latestDebrief ? (
        <Link href={`/me/${athlete.id}/runs/${latestRun!.activityId}`} className="block transition hover:opacity-95">
          <RunDebriefCard debrief={latestDebrief} daysAgo={latestRun!.daysAgo} />
        </Link>
      ) : (
        latestRun && (
          <RunFeedbackCard feedback={latestRun.feedback} href={`/me/${athlete.id}/runs/${latestRun.activityId}`} />
        )
      )}

      {/* Cross-training credit — your rides build the engine, even between runs */}
      <CrossTrainingCard summary={crossTraining} />

      {/* Nothing logged lately → a constructive nudge, not a blank space */}
      {!latestRun && crossTraining.sessions === 0 && !calendar.hasActuals && (
        <Card title="No activity logged yet">
          <p className="text-sm text-slate-600">
            Your runs and rides show up here automatically once Strava is connected — with a coach’s debrief on every
            run. Until then, this is where today’s session and your recent training will live.
          </p>
          <a href="#setup" className="mt-3 inline-block text-sm font-medium text-violet-300 hover:underline">
            Connect Strava to auto-import →
          </a>
        </Card>
      )}

      {/* Consistency / streak — positive reinforcement */}
      {consistency?.show && <ConsistencyStrip stats={consistency} />}

      {/* Chat — ask anything or change the plan */}
      <Card title="Your coach, on demand">
        <TrainingChat athleteId={athlete.id} configured={chatConfigured()} />
      </Card>

      {/* ── YOUR SEASON: the blocks that push your fitness ──────────────── */}
      <div id="season" className="scroll-mt-4" />
      {timeline && timeline.blocks.length > 0 && (
        <Card title="Your season — block by block">
          <PlanTimeline timeline={timeline} />
          <p className="mt-3 text-[11px] text-slate-400">
            Each block stresses a different system — aerobic base, race-specific work, then a taper so you arrive
            fresh. Races are placed to sharpen, not interrupt.
          </p>
        </Card>
      )}

      {/* Race plan: fitness-grounded target window + warm-up race windows */}
      {racePlan && (
        <Card title="Race plan">
          <RacePlanCard plan={racePlan} athleteId={athlete.id} />
        </Card>
      )}

      {/* ── YOUR TRAINING: one timeline, planned vs actual ───────────────── */}
      <SectionHeader>Your training</SectionHeader>
      <Card title="Planned vs actual">
        {calendar.weeks.length > 0 ? (
          <TrainingCalendar weeks={calendar.weeks} today={today} athleteId={athlete.id} />
        ) : (
          <p className="text-sm text-slate-500">No published plan yet — set a goal above and your calendar fills in.</p>
        )}
      </Card>

      {/* ── PROGRESS: is the work working? ──────────────────────────────── */}
      <div id="progress" className="scroll-mt-4" />
      <SectionHeader>Your progress</SectionHeader>
      {insights?.buildProfile && (
        <Card title="What drives your fitness">
          <p className="text-sm text-slate-700">
            <span className="font-medium">Across your {insights.buildProfile.count} most productive blocks:</span>{' '}
            typically ~{insights.buildProfile.medianWeeklyMiles} mi/wk on ~
            {insights.buildProfile.medianRunDaysPerWeek} run-days/wk
            {insights.buildProfile.medianQualityPerWeek != null
              ? `, ~${insights.buildProfile.medianQualityPerWeek} quality sessions/wk`
              : ''}
            .
          </p>
          {insights.suggestions[0] && (
            <p className="mt-2 text-sm text-slate-600">
              <span className="font-medium text-slate-700">Consider:</span> {insights.suggestions[0].text}
            </p>
          )}
          <Link
            href={`/me/${athlete.id}/insights`}
            className="mt-2 inline-block text-sm font-medium text-sky-300 hover:underline"
          >
            See what drove your best fitness →
          </Link>
        </Card>
      )}

      <Card title="Last 12 weeks">
        <WeeklyVolumeChart summary={trainingSummary} runLinkBase={`/me/${athlete.id}/runs`} />
      </Card>

      {/* ── CHECK IN & ADJUST ────────────────────────────────────────────── */}
      <SectionHeader>Check in &amp; adjust</SectionHeader>
      <Card title={checkedInToday ? 'Today’s check-in ✓' : 'How are you feeling?'}>
        {checkedInToday && todayCheckIn && (
          <p className="mb-3 text-xs text-slate-500">
            Soreness {todayCheckIn.soreness ?? '—'} · Energy {todayCheckIn.energy ?? '—'} · Yesterday RPE{' '}
            {todayCheckIn.yesterdayRpe ?? '—'}. You can update it below.
          </p>
        )}
        <CheckInForm
          athleteId={athlete.id}
          day={today}
          initial={todayCheckIn ? { soreness: todayCheckIn.soreness, energy: todayCheckIn.energy, yesterdayRpe: todayCheckIn.yesterdayRpe } : null}
        />
      </Card>

      <Card title="Need to adjust your training?">
        <p className="mb-3 text-xs text-slate-500">
          Travelling, slammed, or sick? Tell your coach what you need and the plan reshapes around it.
        </p>
        <AvailabilityForm athleteId={athlete.id} />
        {unavailable.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
            {unavailable.map((d) => (
              <li key={d.id} className="text-slate-700">
                {d.from}
                {d.to && d.to !== d.from ? ` → ${d.to}` : ''}
                {d.label ? ` · ${d.label}` : ''}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {goalRace.name && !needsGoal && (
        <Card title="Change your goal or race">
          <GoalSetup athleteId={athlete.id} hasAnchor={hasAnchor} hasGoal />
        </Card>
      )}

      {/* Cycle tracking — only for athletes who've said it's relevant (female)
          or already turned it on. Hidden by default otherwise (no noise). */}
      {(athlete.sex === 'female' || cycleSettings.enabled) && (
        <Card title="Cycle tracking">
          <CycleTracking athleteId={athlete.id} initial={cycleSettings} status={cycleStatus} dismissable />
        </Card>
      )}

      {/* ── SETUP & GEAR ─────────────────────────────────────────────────── */}
      <div id="setup" className="scroll-mt-4" />
      <SectionHeader>Setup &amp; gear</SectionHeader>
      <Card title="Connect your watch (via Strava)">
        <ConnectStrava
          athleteId={athlete.id}
          connected={strava.connected}
          configured={strava.configured}
          lastActivityDay={strava.lastActivityDay}
          firstActivityDay={strava.firstActivityDay}
          activityCount={strava.activityCount}
          autoImport={autoImportStrava}
        />
      </Card>

      <Card title="Shoe mileage">
        <ShoesPanel athleteId={athlete.id} shoes={shoes} recentRuns={recentRuns} />
      </Card>

      <Card title="Put your plan in your calendar">
        <CalendarSubscribe athleteId={athlete.id} />
      </Card>

      <BottomNav />
    </div>
  );
}

/** Small uppercase divider label that groups the cards into sections. */
function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="px-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</h2>;
}
