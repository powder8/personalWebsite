import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAthletePortal, type PortalSession } from '@/server/portal';
import { getTrainingInsights } from '@/server/insights';
import { BandBadge, Card } from '@/components/ui';
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
 * Athlete-facing portal (magic-link surface). Focused on "what do I do today /
 * this week", plus the two things only the athlete can provide: a daily check-in
 * and their availability. Distinct from the coach console.
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

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Hi {firstName} 👋</h1>
        <p className="text-sm text-slate-500">{today}</p>
      </div>

      {/* 1 — YOUR GOAL (the north star) */}
      <GoalHero goalRace={goalRace} />

      {/* 2 — TODAY (what to do right now) */}
      <Card title="Today">
        <div className="flex items-center gap-3">
          <BandBadge band={readiness.band} score={readiness.score} />
          <p className="text-sm text-slate-700">
            {readiness.sentence ?? 'No readiness reading yet — your check-in below helps.'}
          </p>
        </div>
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
          {todaySession ? <SessionLine s={todaySession} big /> : (
            <p className="text-sm text-slate-500">No session scheduled today — rest up.</p>
          )}
        </div>
      </Card>

      {/* Chat — pinned near the top: ask anything or change the plan */}
      <Card title="Ask or change anything">
        <TrainingChat athleteId={athlete.id} configured={chatConfigured()} />
      </Card>

      {/* 3 — THIS WEEK (the near-term plan) */}
      <SectionHeader>This week &amp; ahead</SectionHeader>
      <Card title={thisWeek ? `This week${thisWeek.phase ? ` · ${thisWeek.phase}` : ''}` : 'This week'}>
        {thisWeek ? (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {thisWeek.sessions.map((s) => (
                <tr key={s.id} className={s.day === today ? 'bg-sky-50' : ''}>
                  <td className="w-12 px-2 py-2 font-medium text-slate-500">{dow(s.day)}</td>
                  <td className="w-14 px-2 py-2 text-slate-700">{miles(s.distanceMeters)} mi</td>
                  <td className="px-2 py-2">
                    <SessionLine s={s} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-500">No published plan for this week yet.</p>
        )}
      </Card>

      {comingWeeks.length > 0 && (
        <Card title="Coming weeks">
          <div className="space-y-4">
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
                        <td className="w-14 px-2 py-1 text-slate-700">{miles(s.distanceMeters)} mi</td>
                        <td className="px-2 py-1">
                          <span className="capitalize text-slate-800">{s.sessionType.replace('_', ' ')}</span>
                          {s.paceFastSecPerKm != null && (
                            <span className="ml-2 text-xs text-slate-400">
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
        </Card>
      )}

      {/* 4 — YOUR PROGRESS (are you moving toward the goal?) */}
      <SectionHeader>Your progress</SectionHeader>
      {insights?.buildProfile && (
        <Card title="Your training patterns">
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
            See your training patterns →
          </Link>
        </Card>
      )}

      <Card title="Last 12 weeks">
        <WeeklyVolumeChart summary={trainingSummary} />
      </Card>

      {/* 5 — CHECK IN & ADJUST (your inputs that shape the plan) */}
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

      {/* 6 — SETUP & GEAR (one-time / peripheral) */}
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

/** The north-star hero: the race you're training for, or a prompt to set a goal. */
function GoalHero({ goalRace }: { goalRace: { name: string | null; date: string | null; daysAway: number | null } }) {
  if (goalRace.name) {
    return (
      <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">Your goal</div>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">{goalRace.name}</div>
            {goalRace.date && <div className="text-sm text-slate-500">{goalRace.date}</div>}
          </div>
          {goalRace.daysAway != null && goalRace.daysAway >= 0 && (
            <div className="text-right leading-none">
              <div className="text-2xl font-bold text-violet-700">{goalRace.daysAway}</div>
              <div className="text-xs text-slate-500">days to go</div>
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Your goal</div>
      <p className="mt-1 text-sm font-medium text-slate-800">What are you training for?</p>
      <p className="mt-1 text-sm text-slate-500">
        A first 5K, a marathon time, or just building consistent fitness. Tell your coach your goal and they’ll
        build your plan — goal-setting right here is coming soon.
      </p>
    </div>
  );
}

function SessionLine({ s, big = false }: { s: PortalSession; big?: boolean }) {
  return (
    <div>
      <span className={`capitalize text-slate-800 ${big ? 'text-base font-medium' : ''}`}>
        {s.sessionType.replace('_', ' ')}
      </span>
      {big && s.distanceMeters != null && s.distanceMeters > 0 && (
        <span className="ml-2 text-slate-600">{miles(s.distanceMeters)} mi</span>
      )}
      {s.paceFastSecPerKm != null && (
        <span className="ml-2 text-xs text-slate-400">
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
