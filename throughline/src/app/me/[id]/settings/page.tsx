import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { auth, signOut } from '@/auth';
import { authConfigured } from '@/auth.config';
import { getAthletePortal } from '@/server/portal';
import { getTrainingInsights } from '@/server/insights';
import { Card } from '@/components/ui';
import { secPerKmToMinPerMile } from '@/engine/plan';
import { ConnectStrava } from '@/components/ConnectStrava';
import { CalendarSubscribe } from '@/components/CalendarSubscribe';
import { CycleTracking } from '@/components/CycleTracking';
import { getCycle, computeCycle } from '@/server/cycle';
import { WeeklyVolumeChart } from '@/components/WeeklyVolumeChart';
import { getTrainingSummary } from '@/server/weeklyVolume';
import { ShoesPanel } from '@/components/ShoesPanel';
import { listShoesWithMileage, listRecentRunsForShoes } from '@/server/shoes';
import { GoalSetup } from '@/components/GoalSetup';
import { getAthleteVdot } from '@/db/paceConfig';
import { getSeasonTimeline } from '@/server/blocks';
import { getRacePlan } from '@/server/racePlan';
import { RacePlanCard } from '@/components/RacePlanCard';
import { PlanTimeline } from '@/components/PlanTimeline';
import { CheckInForm } from '@/components/CheckInForm';
import { AvailabilityForm } from '@/components/AvailabilityForm';
import { BottomNav } from '@/components/BottomNav';
import { getDb } from '@/db';
import { todayISO } from '@/server/console';

export const dynamic = 'force-dynamic';

function pace(sec: number | null): string {
  return sec == null ? '' : `${secPerKmToMinPerMile(sec)}/mi`;
}

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const portal = await getAthletePortal(id);
  if (!portal) notFound();

  const db = await getDb();
  const today = todayISO();

  const [
    insights,
    cycleSettings,
    trainingSummary,
    shoes,
    recentRuns,
    hasAnchorRaw,
    timeline,
    racePlan,
  ] = await Promise.all([
    getTrainingInsights(id),
    getCycle(db, id),
    getTrainingSummary(db, id, today, 12),
    listShoesWithMileage(db, id),
    listRecentRunsForShoes(db, id, 12),
    getAthleteVdot(db, id),
    getSeasonTimeline(db, id, today),
    getRacePlan(db, id, today),
  ]);

  const hasAnchor = hasAnchorRaw != null;
  const cycleStatus = computeCycle(cycleSettings, today);

  const session = authConfigured() ? await auth() : null;

  const { athlete, goalRace, unavailable, checkedInToday, recentCheckIns, strava } = portal;
  const todayCheckIn = recentCheckIns.find((c) => c.day === today) ?? null;
  const goalDone = !!goalRace.name && goalRace.daysAway != null && goalRace.daysAway < 0;
  const needsGoal = !goalRace.name || goalDone;

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-20 sm:pb-4">
      {/* Back nav */}
      <div className="flex items-center gap-3 px-1 pt-3">
        <Link
          href={`/me/${id}`}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to training
        </Link>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">· Settings</span>
      </div>

      {/* ── ACCOUNT ──────────────────────────────────────────────────────── */}
      <SectionHeader>Account</SectionHeader>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="font-semibold text-slate-800">{athlete.fullName}</p>
            <p className="text-sm text-slate-500">{session?.user?.email ?? athlete.email}</p>
            <p className="text-xs text-slate-400">
              {athlete.coachingMode === 'autonomous' ? 'Auto-coached — AI builds and adjusts your plan' : 'Coach-guided — your coach reviews and adjusts the plan'}
            </p>
          </div>
          {session && authConfigured() && (
            <form
              action={async () => {
                'use server';
                await signOut({ redirectTo: '/signin' });
              }}
            >
              <button
                type="submit"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:border-slate-300 hover:text-slate-700"
              >
                Sign out
              </button>
            </form>
          )}
        </div>
      </Card>

      {/* ── STRAVA ───────────────────────────────────────────────────────── */}
      <SectionHeader>Sync</SectionHeader>
      <Card title="Connect your watch (via Strava)">
        <ConnectStrava
          athleteId={athlete.id}
          connected={strava.connected}
          configured={strava.configured}
          lastActivityDay={strava.lastActivityDay}
          firstActivityDay={strava.firstActivityDay}
          activityCount={strava.activityCount}
        />
      </Card>

      {/* ── CHECK IN ─────────────────────────────────────────────────────── */}
      <SectionHeader>Check in</SectionHeader>
      <Card title={checkedInToday ? "Today's check-in ✓" : 'How are you feeling today?'}>
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

      {/* ── TRAINING ADJUSTMENTS ─────────────────────────────────────────── */}
      <SectionHeader>Adjust training</SectionHeader>
      <Card title="Need to adjust your plan?">
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

      {(athlete.sex === 'female' || cycleSettings.enabled) && (
        <Card title="Cycle tracking">
          <CycleTracking athleteId={athlete.id} initial={cycleSettings} status={cycleStatus} dismissable />
        </Card>
      )}

      {/* ── PROGRESS ─────────────────────────────────────────────────────── */}
      <SectionHeader>Progress</SectionHeader>
      {timeline && timeline.blocks.length > 0 && (
        <Card title="Your season — block by block">
          <PlanTimeline timeline={timeline} />
          <p className="mt-3 text-[11px] text-slate-400">
            Each block stresses a different system — aerobic base, race-specific work, then a taper so you arrive
            fresh. Races are placed to sharpen, not interrupt.
          </p>
        </Card>
      )}

      {racePlan && (
        <Card title="Race plan">
          <RacePlanCard plan={racePlan} athleteId={athlete.id} />
        </Card>
      )}

      {insights?.buildProfile && (
        <Card title="What drives your fitness">
          <p className="text-sm text-slate-700">
            <span className="font-medium">
              Across your {insights.buildProfile.count} most productive blocks:
            </span>{' '}
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

      {/* ── GEAR ─────────────────────────────────────────────────────────── */}
      <SectionHeader>Gear &amp; integrations</SectionHeader>
      <Card title="Shoe mileage">
        <ShoesPanel athleteId={athlete.id} shoes={shoes} recentRuns={recentRuns} />
      </Card>

      <Card title="Put your plan in your calendar">
        <CalendarSubscribe athleteId={athlete.id} />
      </Card>

      <BottomNav athleteId={athlete.id} />
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="px-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</h2>;
}
