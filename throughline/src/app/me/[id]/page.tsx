import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAthletePortal, type PortalSession } from '@/server/portal';
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
import { getTrainingSummary } from '@/server/weeklyVolume';
import { ShoesPanel } from '@/components/ShoesPanel';
import { listShoesWithMileage, listRecentRunsForShoes } from '@/server/shoes';
import { GoalSetup } from '@/components/GoalSetup';
import { getAthleteVdot } from '@/db/paceConfig';
import { getSeasonTimeline } from '@/server/blocks';
import { PlanTimeline } from '@/components/PlanTimeline';
import { WeekStrip, SESSION_COLOR, SESSION_LABEL } from '@/components/WeekStrip';
import { getDb } from '@/db';

export const dynamic = 'force-dynamic';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function pace(sec: number | null): string {
  return sec == null ? '' : `${secPerKmToMinPerMile(sec)}/mi`;
}
function miles(m: number | null): string {
  return m == null || m <= 0 ? '—' : (m / 1609.344).toFixed(1);
}
function dow(day: string): string {
  const [y, mo, d] = day.split('-').map(Number);
  const idx = ((Math.floor(Date.UTC(y, mo - 1, d) / 86400000) % 7) + 3) % 7;
  return DOW[idx];
}

/**
 * Athlete-facing portal. Reads top-to-bottom as a story: goal (hero) → today →
 * the season's blocks → this week → progress → your inputs → setup.
 */
export default async function PortalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const portal = await getAthletePortal(id);
  if (!portal) notFound();
  const insights = await getTrainingInsights(id);

  const db = await getDb();
  const cycleSettings = await getCycle(db, id);
  const cycleStatus = computeCycle(cycleSettings, portal.today);
  const trainingSummary = await getTrainingSummary(db, id, portal.today, 12);
  const shoes = await listShoesWithMileage(db, id);
  const recentRuns = await listRecentRunsForShoes(db, id, 12);
  const hasAnchor = (await getAthleteVdot(db, id)) != null;
  const timeline = await getSeasonTimeline(db, id, portal.today);

  const {
    athlete,
    today,
    readiness,
    todaySession,
    thisWeek,
    comingWeeks,
    goalRace,
    unavailable,
    checkedInToday,
    recentCheckIns,
    strava,
  } = portal;

  const firstName = athlete.fullName.split(' ')[0];
  const todayCheckIn = recentCheckIns.find((c) => c.day === today) ?? null;
  const currentPhase = timeline?.blocks.find((b) => b.current)?.phase ?? thisWeek?.phase ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* ── HERO: who you are + what you're chasing ─────────────────────── */}
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 p-6 text-white shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-slate-400">Hi {firstName} 👋 · {today}</p>
            {goalRace.name ? (
              <>
                <h1 className="mt-2 truncate text-2xl font-bold tracking-tight">{goalRace.name}</h1>
                <p className="mt-0.5 text-sm text-slate-400">{goalRace.date}</p>
              </>
            ) : (
              <h1 className="mt-2 text-2xl font-bold tracking-tight">Let’s set your goal</h1>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {currentPhase && (
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold capitalize text-slate-100 ring-1 ring-inset ring-white/15">
                  {currentPhase} block
                </span>
              )}
              {readiness.band && (
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold capitalize text-slate-100 ring-1 ring-inset ring-white/15">
                  Readiness: {readiness.band}
                </span>
              )}
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-100 ring-1 ring-inset ring-white/15">
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
      </div>

      {/* Goal setup: open when no goal; a quiet "Change goal" otherwise */}
      {goalRace.name ? (
        <div className="px-2">
          <GoalSetup athleteId={athlete.id} hasAnchor={hasAnchor} hasGoal />
        </div>
      ) : (
        <Card title="What are you training for?">
          <GoalSetup athleteId={athlete.id} hasAnchor={hasAnchor} hasGoal={false} />
        </Card>
      )}

      {/* ── TODAY ────────────────────────────────────────────────────────── */}
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Today</h2>
          {readiness.sentence && <span className="hidden text-xs text-slate-400 sm:inline">{readiness.sentence}</span>}
        </div>
        {todaySession ? (
          <div className="flex items-center gap-4 rounded-2xl bg-slate-50 p-4">
            <span
              className={`h-10 w-10 shrink-0 rounded-2xl ${SESSION_COLOR[todaySession.sessionType] ?? 'bg-slate-300'}`}
            />
            <div className="min-w-0">
              <div className="text-lg font-bold tracking-tight text-slate-900">
                {SESSION_LABEL[todaySession.sessionType] ?? todaySession.sessionType}
                {todaySession.distanceMeters != null && todaySession.distanceMeters > 0 && (
                  <span className="ml-2 text-slate-500">{miles(todaySession.distanceMeters)} mi</span>
                )}
              </div>
              {todaySession.paceFastSecPerKm != null && (
                <div className="text-sm tabular-nums text-slate-500">
                  {pace(todaySession.paceFastSecPerKm)}–{pace(todaySession.paceSlowSecPerKm)}
                </div>
              )}
              {todaySession.adjustments.length > 0 && (
                <div className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                  {todaySession.adjustments.join('; ')}
                </div>
              )}
              {todaySession.description && <p className="mt-1 text-xs text-slate-500">{todaySession.description}</p>}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4 rounded-2xl bg-slate-50 p-4">
            <span className="h-10 w-10 shrink-0 rounded-2xl bg-slate-200" />
            <div>
              <div className="text-lg font-bold tracking-tight text-slate-900">Rest day</div>
              <p className="text-sm text-slate-500">Recovery is training too.</p>
            </div>
          </div>
        )}
      </Card>

      {/* Chat — ask anything or change the plan */}
      <Card title="Your coach, on demand">
        <TrainingChat athleteId={athlete.id} configured={chatConfigured()} />
      </Card>

      {/* ── YOUR SEASON: the blocks that push your fitness ──────────────── */}
      {timeline && timeline.blocks.length > 0 && (
        <Card title="Your season — block by block">
          <PlanTimeline timeline={timeline} />
          <p className="mt-3 text-[11px] text-slate-400">
            Each block stresses a different system — aerobic base, race-specific work, then a taper so you arrive
            fresh. Races are placed to sharpen, not interrupt.
          </p>
        </Card>
      )}

      {/* ── THIS WEEK ────────────────────────────────────────────────────── */}
      <SectionHeader>This week &amp; ahead</SectionHeader>
      <Card title={thisWeek ? `This week${thisWeek.phase ? ` · ${thisWeek.phase}` : ''}` : 'This week'}>
        {thisWeek ? (
          <>
            <WeekStrip sessions={thisWeek.sessions} today={today} />
            <table className="mt-3 w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {thisWeek.sessions.map((s) => (
                  <tr key={s.id} className={s.day === today ? 'bg-sky-50/60' : ''}>
                    <td className="w-12 px-2 py-2 font-medium text-slate-500">{dow(s.day)}</td>
                    <td className="w-14 px-2 py-2 tabular-nums text-slate-700">{miles(s.distanceMeters)} mi</td>
                    <td className="px-2 py-2">
                      <SessionLine s={s} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-sm text-slate-500">No published plan for this week yet.</p>
        )}
      </Card>

      {comingWeeks.length > 0 && (
        <Card>
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">
              Coming weeks <span className="font-normal text-slate-400">· {comingWeeks.length} planned</span>
            </summary>
            <div className="mt-3 space-y-4">
              {comingWeeks.map((w) => (
                <div key={w.weekStart}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Week of {w.weekStart}
                    {w.phase && <span className="capitalize"> · {w.phase}</span>}
                  </div>
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-100">
                      {w.sessions.map((s) => (
                        <tr key={s.id}>
                          <td className="w-12 px-2 py-1 font-medium text-slate-500">{dow(s.day)}</td>
                          <td className="w-14 px-2 py-1 tabular-nums text-slate-700">{miles(s.distanceMeters)} mi</td>
                          <td className="px-2 py-1">
                            <span className="text-slate-800">{SESSION_LABEL[s.sessionType] ?? s.sessionType}</span>
                            {s.paceFastSecPerKm != null && (
                              <span className="ml-2 text-xs tabular-nums text-slate-400">
                                {pace(s.paceFastSecPerKm)}–{pace(s.paceSlowSecPerKm)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </details>
        </Card>
      )}

      {/* ── PROGRESS: is the work working? ──────────────────────────────── */}
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
            className="mt-2 inline-block text-sm font-medium text-sky-700 hover:underline"
          >
            See what drove your best fitness →
          </Link>
        </Card>
      )}

      <Card title="Last 12 weeks">
        <WeeklyVolumeChart summary={trainingSummary} />
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

      <Card title="Cycle tracking">
        <CycleTracking athleteId={athlete.id} initial={cycleSettings} status={cycleStatus} />
      </Card>

      {/* ── SETUP & GEAR ─────────────────────────────────────────────────── */}
      <SectionHeader>Setup &amp; gear</SectionHeader>
      <Card title="Connect your watch (via Strava)">
        <ConnectStrava
          athleteId={athlete.id}
          connected={strava.connected}
          configured={strava.configured}
          lastActivityDay={strava.lastActivityDay}
        />
      </Card>

      <Card title="Shoe mileage">
        <ShoesPanel athleteId={athlete.id} shoes={shoes} recentRuns={recentRuns} />
      </Card>

      <Card title="Put your plan in your calendar">
        <CalendarSubscribe athleteId={athlete.id} />
      </Card>
    </div>
  );
}

/** Small uppercase divider label that groups the cards into sections. */
function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="px-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</h2>;
}

function SessionLine({ s }: { s: PortalSession }) {
  return (
    <div>
      <span className="inline-flex items-center gap-1.5 text-slate-800">
        <span className={`h-2 w-2 rounded-full ${SESSION_COLOR[s.sessionType] ?? 'bg-slate-300'}`} />
        {SESSION_LABEL[s.sessionType] ?? s.sessionType}
      </span>
      {s.paceFastSecPerKm != null && (
        <span className="ml-2 text-xs tabular-nums text-slate-400">
          {pace(s.paceFastSecPerKm)}–{pace(s.paceSlowSecPerKm)}
        </span>
      )}
      {s.adjustments.length > 0 && (
        <span className="ml-2 rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-700">
          {s.adjustments.join('; ')}
        </span>
      )}
      {s.description && <p className="mt-0.5 text-xs text-slate-500">{s.description}</p>}
    </div>
  );
}
