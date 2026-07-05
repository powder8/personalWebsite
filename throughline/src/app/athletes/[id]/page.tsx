import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAthleteDetail, todayISO, type Band } from '@/server/console';
import { BandBadge, Card, Sparkline } from '@/components/ui';
import { secPerKmToMinPerMile, purposeLabel, ageFromDob } from '@/engine/plan';
import { DobControl } from '@/components/DobControl';
import { TrainingChat } from '@/components/TrainingChat';
import { chatConfigured } from '@/server/chat';
import { EscalationActions } from '@/components/EscalationActions';
import { ESCALATION_LABELS } from '@/server/escalations';
import { PaceAdjustForm } from '@/components/PaceAdjustForm';
import { AdjustmentForm } from '@/components/AdjustmentForm';
import { PostButton } from '@/components/PostButton';
import { StrengthControl } from '@/components/StrengthControl';
import { AnchorControl } from '@/components/AnchorControl';
import { PmcChart, PmcLegend } from '@/components/PmcChart';
import { getFitnessFatigueSeries } from '@/server/fitness';
import { getComplianceWeeks, type DayStatus } from '@/server/compliance';
import { getTrainingInsights } from '@/server/insights';
import { getCycle, computeCycle } from '@/server/cycle';
import { WeeklyVolumeChart } from '@/components/WeeklyVolumeChart';
import { getTrainingSummary } from '@/server/weeklyVolume';
import { SegmentList } from '@/components/SegmentList';
import type { PortalSegment } from '@/server/portal';
import { getDb } from '@/db';

export const dynamic = 'force-dynamic';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function pace(sec: number | null): string {
  return sec == null ? '' : `${secPerKmToMinPerMile(sec)}/mi`;
}
function miles(m: number | null): string {
  return m == null ? '—' : (m / 1609.344).toFixed(1);
}
function dow(day: string): string {
  const [y, mo, d] = day.split('-').map(Number);
  const idx = ((Math.floor(Date.UTC(y, mo - 1, d) / 86400000) % 7) + 3) % 7;
  return DOW[idx];
}

export default async function AthletePage({ params }: { params: Promise<{ id: string }> }) {
  const TODAY = todayISO();
  const { id } = await params;
  const detail = await getAthleteDetail(id);
  if (!detail) notFound();
  const fitness = await getFitnessFatigueSeries(id);
  const compliance = await getComplianceWeeks(id, TODAY);
  const insights = await getTrainingInsights(id);
  const db = await getDb();
  const cycle = computeCycle(await getCycle(db, id), TODAY);
  const trainingSummary = await getTrainingSummary(db, id, TODAY, 12);

  const {
    athlete,
    readinessToday,
    readinessHistory,
    currentWeek,
    checkIns,
    notes,
    injuries,
    races,
    raceWindows,
    escalations,
    upcomingWeeks,
    directives,
    paceZones,
    vdot,
    equivalents,
    anchorSuggestions,
    anchorSource,
    strengthBias,
    activitySummary,
    activities,
    signals,
  } = detail;

  const paceMi = (secPerKm: number | null) =>
    secPerKm == null ? '—' : `${secPerKmToMinPerMile(secPerKm)}/mi`;

  const ADJ_LABEL: Record<string, string> = {
    pace_adjust: 'Slower paces',
    reduce_volume: 'Reduced volume',
    unavailable: 'Unavailable (rest)',
  };

  return (
    <div className="space-y-5">
      <div>
        <Link href="/coach" className="text-sm text-sky-300 hover:underline">
          ← Roster
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-900">{athlete.fullName}</h1>
          <div className="text-right text-sm text-slate-500">
            <div>
              {athlete.goalRace}
              {athlete.goalRaceDate && <span> · {athlete.goalRaceDate}</span>}
            </div>
            <div className="flex justify-end gap-3">
              <Link href={`/me/${athlete.id}`} className="text-sky-300 hover:underline">
                Athlete view →
              </Link>
              <Link href={`/athletes/${athlete.id}/insights`} className="text-sky-300 hover:underline">
                Insights →
              </Link>
              <Link href={`/athletes/${athlete.id}/plan`} className="text-sky-300 hover:underline">
                Season plan →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Insights — lead with it; this is the differentiator */}
      {insights && (insights.buildProfile || insights.suggestions.length > 0) && (
        <Card title="Insights" className="border-sky-400/30 bg-sky-400/10">
          {insights.buildProfile && (
            <div className="text-sm text-slate-700">
              <span className="font-medium">
                Across your {insights.buildProfile.count} most productive blocks:
              </span>{' '}
              typically ~{insights.buildProfile.medianWeeklyMiles} mi/wk on ~
              {insights.buildProfile.medianRunDaysPerWeek} run-days/wk
              {insights.buildProfile.medianQualityPerWeek != null
                ? `, ~${insights.buildProfile.medianQualityPerWeek} quality sessions/wk`
                : ''}
              {insights.buildProfile.blocksWithLongRuns > 0
                ? `, long runs in ${insights.buildProfile.blocksWithLongRuns}/${insights.buildProfile.count}`
                : ''}
              .
            </div>
          )}
          {insights.suggestions.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {insights.suggestions.slice(0, 2).map((s, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      s.basis === 'science' ? 'bg-violet-400/15 text-violet-300' : 'bg-emerald-400/15 text-emerald-300'
                    }`}
                  >
                    {s.basis === 'science' ? 'science' : 'history'}
                  </span>
                  <span className="text-slate-700">{s.text}</span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/athletes/${athlete.id}/insights`}
            className="mt-2 inline-block text-sm font-medium text-sky-300 hover:underline"
          >
            Full insights →
          </Link>
        </Card>
      )}

      {/* Coaching assistant — ask or change this athlete's plan */}
      <Card title="Coaching assistant">
        <TrainingChat athleteId={athlete.id} configured={chatConfigured()} audience="coach" />
      </Card>

      {/* Autopilot escalations needing review */}
      {escalations.length > 0 && (
        <Card title="Needs review (autopilot held)" className="border-rose-400/30">
          <ul className="space-y-2 text-sm">
            {escalations.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3">
                <div>
                  <span className="rounded bg-rose-400/10 px-1.5 py-0.5 text-xs font-medium text-rose-300 ring-1 ring-inset ring-rose-400/30">
                    {ESCALATION_LABELS[e.kind] ?? e.kind}
                  </span>
                  <p className="mt-1 text-slate-600">{e.reason}</p>
                </div>
                <EscalationActions id={e.id} status={e.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Today's readiness */}
      <Card title={`Readiness — ${TODAY}`}>
        <div className="flex items-center gap-3">
          <BandBadge band={(readinessToday?.band as Band) ?? null} score={readinessToday?.score ?? null} />
          <p className="text-sm text-slate-700">{readinessToday?.sentence ?? 'No assessment today.'}</p>
        </div>
        <div className="mt-3 flex items-end gap-2">
          <Sparkline values={readinessHistory.map((r) => r.score)} width={320} height={40} />
          <span className="text-xs text-slate-400">14-day readiness</span>
        </div>
      </Card>

      {/* Season races */}
      <Card title="Season races">
        {races.length ? (
          <ul className="space-y-2 text-sm">
            {races.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3">
                <div>
                  <RacePriorityBadge priority={r.priority} purpose={r.purpose} />
                  <span className="ml-2 font-medium text-slate-800">{r.name}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {r.date}
                    {r.distanceLabel && ` · ${r.distanceLabel}`}
                  </span>
                </div>
                <div className="text-right text-xs text-slate-600">
                  {raceGoal(r)}
                  {r.status !== 'planned' && <span className="ml-2 text-slate-400">({r.status})</span>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No races scheduled.</p>
        )}

        {raceWindows.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Suggested race windows
            </h3>
            <ul className="space-y-2 text-sm">
              {raceWindows.map((w) => (
                <li key={w.kind} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-medium text-slate-800">{w.label}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {w.fromDate} → {w.toDate}
                    </span>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
                      <span>
                        <span className="text-slate-400">distance</span> {w.primaryDistance}
                        {w.suggestedDistances.length > 1 && (
                          <span className="text-slate-400"> (or {w.suggestedDistances.slice(1).join('/')})</span>
                        )}
                      </span>
                      {w.targetPaceLabel && (
                        <span>
                          <span className="text-slate-400">target pace</span> {w.targetPaceLabel}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      <span className="text-slate-400">course:</span> {w.courseProfile}
                    </p>
                    <p className="text-xs text-slate-500">
                      <span className="text-slate-400">effort:</span> {w.effortNote}
                    </p>
                  </div>
                  {w.filledBy ? (
                    <span className="whitespace-nowrap rounded bg-emerald-400/10 px-1.5 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
                      ✓ {w.filledBy.name}
                    </span>
                  ) : (
                    <span className="whitespace-nowrap rounded bg-amber-400/10 px-1.5 py-0.5 text-xs font-medium text-amber-300 ring-1 ring-inset ring-amber-400/30">
                      open
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* Imported training history */}
      {activitySummary.count > 0 && (
        <Card
          title={`Training history — ${activitySummary.count} activities · ${activitySummary.totalMiles} mi${
            activitySummary.firstDay ? ` (${activitySummary.firstDay} → ${activitySummary.lastDay})` : ''
          }`}
        >
          <div className="max-h-96 overflow-y-auto rounded border border-slate-100">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-2 py-1 font-medium">Date</th>
                  <th className="px-2 py-1 font-medium">Workout</th>
                  <th className="px-2 py-1 font-medium">Distance</th>
                  <th className="px-2 py-1 font-medium">Pace</th>
                  <th className="px-2 py-1 font-medium">Sport</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activities.map((a, i) => (
                  <tr key={`${a.day}-${i}`}>
                    <td className="px-2 py-1 text-slate-600">{a.day}</td>
                    <td className="px-2 py-1 text-slate-700">{a.name ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-1 text-slate-700">{a.distanceMiles} mi</td>
                    <td className="px-2 py-1 text-slate-500">{paceMi(a.paceSecPerKm)}</td>
                    <td className="px-2 py-1 capitalize text-slate-500">{a.sport.replace('_', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">All {activities.length} imported runs — scroll to browse.</p>
        </Card>
      )}

      {/* Signals vs baseline */}
      <Card title="Signals (28 days)">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SignalCell label="HRV (ms)" series={signals.hrv} stroke="#0ea5e9" />
          <SignalCell label="Resting HR (bpm)" series={signals.restingHr} stroke="#ef4444" />
          <SignalCell label="Sleep (hrs)" series={signals.sleepHours} stroke="#8b5cf6" />
        </div>
      </Card>

      {/* Last 12 weeks: mileage + elevation + key efforts */}
      <Card title="Last 12 weeks">
        <WeeklyVolumeChart summary={trainingSummary} runLinkBase={`/me/${athlete.id}/runs`} />
      </Card>

      {/* Fitness & fatigue (PMC) */}
      {fitness.current && (
        <Card title="Fitness & fatigue">
          <div className="mb-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="text-slate-400">Fitness (CTL)</span>{' '}
              <span className="font-medium tabular-nums text-sky-300">{fitness.current.ctl.toFixed(0)}</span>
            </span>
            <span>
              <span className="text-slate-400">Fatigue (ATL)</span>{' '}
              <span className="font-medium tabular-nums text-orange-600">{fitness.current.atl.toFixed(0)}</span>
            </span>
            <span>
              <span className="text-slate-400">Form (TSB)</span>{' '}
              <span
                className={`font-medium tabular-nums ${
                  fitness.current.tsb >= 0 ? 'text-emerald-300' : 'text-rose-600'
                }`}
              >
                {fitness.current.tsb >= 0 ? '+' : ''}
                {fitness.current.tsb.toFixed(0)}
              </span>
              {fitness.form && <span className="ml-1 text-xs capitalize text-slate-400">({fitness.form})</span>}
            </span>
          </div>
          <PmcChart points={fitness.points} />
          <div className="mt-2">
            <PmcLegend />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Banister CTL/ATL/TSB from training load
            {fitness.estimated ? ' (volume-estimated — no HR/power on these activities)' : ''}. Last{' '}
            {fitness.points.length} days.
          </p>
        </Card>
      )}

      {/* Adherence / compliance */}
      {compliance.weeks.length > 0 && (
        <Card title="Adherence (planned vs actual)">
          {compliance.hasActuals ? (
            <div className="space-y-3">
              {compliance.weeks.map((w) => (
                <div key={w.weekStart} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="w-24 text-xs font-medium text-slate-500">{w.weekStart}</span>
                  <span className="flex gap-0.5">
                    {w.days.map((d) => (
                      <span
                        key={d.day}
                        title={`${d.day}: ${d.status}${
                          d.plannedMiles ? ` · planned ${d.plannedMiles.toFixed(1)}mi` : ''
                        }${d.actualMiles ? ` · actual ${d.actualMiles.toFixed(1)}mi` : ''}`}
                        className={`inline-block h-3 w-3 rounded-sm ${STATUS_COLOR[d.status]}`}
                      />
                    ))}
                  </span>
                  <span className="text-xs tabular-nums text-slate-600">
                    {w.actualMiles.toFixed(0)}/{w.plannedMiles.toFixed(0)} mi
                  </span>
                  {w.adherencePct != null && (
                    <span
                      className={`text-xs font-medium tabular-nums ${
                        w.adherencePct >= 80 ? 'text-emerald-300' : w.adherencePct >= 50 ? 'text-amber-300' : 'text-rose-600'
                      }`}
                    >
                      {w.adherencePct}% ({w.sessionsDone}/{w.sessionsPlanned})
                    </span>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                <Legend color={STATUS_COLOR.done} label="done" />
                <Legend color={STATUS_COLOR.partial} label="partial" />
                <Legend color={STATUS_COLOR.missed} label="missed" />
                <Legend color={STATUS_COLOR.extra} label="extra" />
                <Legend color={STATUS_COLOR.upcoming} label="upcoming" />
                <Legend color={STATUS_COLOR.rest} label="rest" />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              No completed-activity data yet. Connect Strava (or import a current training log) to track
              planned-vs-actual adherence.
            </p>
          )}
        </Card>
      )}

      {/* Current plan week */}
      <Card title={currentWeek ? `This week — ${currentWeek.plan.phase ?? ''} (cycle ${currentWeek.plan.cycle ?? '—'})` : 'This week'}>
        {currentWeek ? (
          <>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {currentWeek.sessions.map((s) => {
                  const isToday = s.day === TODAY;
                  return (
                    <tr key={s.id} className={isToday ? 'bg-sky-400/10' : ''}>
                      <td className="w-12 px-2 py-2 font-medium text-slate-500">{dow(s.day)}</td>
                      <td className="w-16 px-2 py-2 text-slate-700">{miles(s.targetDistanceMeters)} mi</td>
                      <td className="px-2 py-2">
                        <span className="capitalize text-slate-800">{s.sessionType}</span>
                        {s.targetPaceFastSecPerKm != null && (
                          <span className="ml-2 text-xs text-slate-400">
                            {pace(s.targetPaceFastSecPerKm)}–{pace(s.targetPaceSlowSecPerKm)}
                          </span>
                        )}
                        {s.pinned && (
                          <span className="ml-2 rounded bg-slate-200 px-1 text-[10px] font-medium text-slate-600">
                            pinned
                          </span>
                        )}
                        {s.adjustments.length > 0 && (
                          <span className="ml-2 rounded bg-amber-400/10 px-1 text-[10px] font-medium text-amber-300">
                            {s.adjustments.join('; ')}
                          </span>
                        )}
                        {(s.segments as PortalSegment[] | null)?.length ? (
                          <details>
                            <summary className="cursor-pointer text-xs font-medium text-sky-300">
                              {s.description ?? 'Workout structure'}
                            </summary>
                            <SegmentList segments={s.segments as PortalSegment[]} />
                          </details>
                        ) : (
                          <p className="text-xs text-slate-500">{s.description}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {currentWeek.plan.rationale && (
              <p className="mt-3 border-t border-slate-100 pt-3 text-xs italic text-slate-500">
                {currentWeek.plan.rationale}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">No published plan for this week.</p>
        )}
      </Card>

      {/* Windowed adjustments + availability */}
      <Card title="Adjustments & availability">
        {directives.length > 0 && (
          <ul className="mb-3 space-y-1.5 text-sm">
            {directives.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-medium text-slate-800">{ADJ_LABEL[d.type] ?? d.type}</span>
                  {d.type === 'pace_adjust' && d.deltaSecPerMile != null && (
                    <span className="text-slate-500"> {d.deltaSecPerMile > 0 ? '+' : ''}{d.deltaSecPerMile}s/mi</span>
                  )}
                  {d.type === 'reduce_volume' && d.factor != null && (
                    <span className="text-slate-500"> → {Math.round(d.factor * 100)}%</span>
                  )}
                  <span className="ml-2 text-xs text-slate-500">
                    {d.from}
                    {d.to ? ` → ${d.to}` : ' → ongoing'}
                    {d.label ? ` · ${d.label}` : ''}
                  </span>
                </div>
                <PostButton url={`/api/directives/${d.id}`} label="Remove" />
              </li>
            ))}
          </ul>
        )}
        <AdjustmentForm athleteId={athlete.id} today={TODAY} />
      </Card>

      {/* Look ahead: the next few weeks (beyond the current one) */}
      {upcomingWeeks.filter((w) => !(w.weekStart <= TODAY && TODAY <= w.weekEnd)).length > 0 && (
        <Card title="Coming weeks">
          <div className="space-y-4">
            {upcomingWeeks
              .filter((w) => !(w.weekStart <= TODAY && TODAY <= w.weekEnd))
              .map((w) => (
                <div key={w.planId}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Week of {w.weekStart} · <span className="capitalize">{w.phase}</span>
                    {w.status === 'draft' && <span className="text-slate-400"> (draft)</span>}
                  </div>
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-100">
                      {w.sessions.map((s) => (
                        <tr key={s.id}>
                          <td className="w-12 px-2 py-1 font-medium text-slate-500">{dow(s.day)}</td>
                          <td className="w-16 px-2 py-1 text-slate-700">
                            {s.targetDistanceMeters ? `${miles(s.targetDistanceMeters)} mi` : '—'}
                          </td>
                          <td className="px-2 py-1">
                            <span className="capitalize text-slate-800">{s.sessionType}</span>
                            {s.targetPaceFastSecPerKm != null && (
                              <span className="ml-2 text-xs text-slate-400">
                                {pace(s.targetPaceFastSecPerKm)}–{pace(s.targetPaceSlowSecPerKm)}
                              </span>
                            )}
                            {s.adjustments.length > 0 && (
                              <span className="ml-2 rounded bg-amber-400/10 px-1 text-[10px] font-medium text-amber-300">
                                {s.adjustments.join('; ')}
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
          <Link
            href={`/athletes/${athlete.id}/plan`}
            className="mt-3 inline-block text-sm text-sky-300 hover:underline"
          >
            Full season plan →
          </Link>
        </Card>
      )}

      {/* Fitness anchor (auto-inferred by default; confirm or override) */}
      {(anchorSuggestions.length > 0 || vdot == null || anchorSource === 'auto') && (
        <Card title="Fitness anchor" className={vdot == null || anchorSource === 'auto' ? 'border-sky-400/30' : ''}>
          <AnchorControl
            athleteId={athlete.id}
            currentVdot={vdot}
            suggestions={anchorSuggestions}
            source={anchorSource}
          />
        </Card>
      )}

      {/* Equivalent race performances (Daniels VDOT) */}
      {equivalents.length > 0 && (
        <Card title={`Equivalent performances${vdot != null ? ` · VDOT ${vdot}` : ''}`}>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {equivalents.map((e) => (
              <span key={e.label}>
                <span className="text-slate-400">{e.label}</span>{' '}
                <span className="font-medium tabular-nums text-slate-800">{fmtTime(e.timeSeconds)}</span>
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Daniels VDOT race-equivalent times — the cross-effort yardstick for progression.
          </p>
        </Card>
      )}

      {/* Profile: date of birth (for future age-grading) */}
      <Card title="Profile">
        <DobControl athleteId={athlete.id} initial={athlete.dateOfBirth} />
        {(() => {
          const age = ageFromDob(athlete.dateOfBirth, TODAY);
          return (
            <p className="mt-2 text-xs text-slate-500">
              {age == null
                ? 'Date of birth is used for age-grading (coming soon). It does not change paces on its own.'
                : `Age ${age}. Used for age-grading (coming soon); it doesn’t change paces on its own.`}
            </p>
          );
        })()}
      </Card>

      {/* Adjust this athlete's pace model */}
      {paceZones.length > 0 && (
        <Card title="Adjust paces (individual model)">
          <div className="mb-3 border-b border-slate-100 pb-3">
            <StrengthControl athleteId={athlete.id} bias={strengthBias} />
          </div>
          <PaceAdjustForm athleteId={athlete.id} zones={paceZones} />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {/* Injuries */}
        <Card title="Injuries & constraints">
          {injuries.length ? (
            <ul className="space-y-2 text-sm">
              {injuries.map((i) => (
                <li key={i.id} className="flex items-start justify-between">
                  <div>
                    <span className="font-medium capitalize text-slate-800">{i.bodyPart}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {i.severity} · {i.status}
                    </span>
                    {i.note && <p className="text-xs text-slate-500">{i.note}</p>}
                  </div>
                  {i.allowedModalities && (
                    <span className="text-xs text-slate-400">{i.allowedModalities.join(', ')}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">None.</p>
          )}
        </Card>

        {/* Notes */}
        <Card title="Coach notes">
          {notes.length ? (
            <ul className="space-y-2 text-sm">
              {notes.map((n) => (
                <li key={n.id}>
                  <span className="text-xs uppercase tracking-wide text-slate-400">{n.kind}</span>
                  <p className="text-slate-700">{n.body}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">None.</p>
          )}
        </Card>
      </div>

      {/* Recent check-ins */}
      <Card title="Recent check-ins">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 font-medium">Soreness</th>
              <th className="py-1 font-medium">Energy</th>
              <th className="py-1 font-medium">Yest. RPE</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {checkIns.map((c) => (
              <tr key={c.id}>
                <td className="py-1.5 text-slate-600">{c.day}</td>
                <td className="py-1.5 text-slate-700">{c.soreness ?? '—'}</td>
                <td className="py-1.5 text-slate-700">{c.energy ?? '—'}</td>
                <td className="py-1.5 text-slate-700">{c.yesterdayRpe ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Cycle phase (only if the athlete opted in; phase only, no dates) */}
      {cycle.enabled && cycle.phase && (
        <Card title="Cycle phase" className={cycle.lateLuteal ? 'border-amber-400/30 bg-amber-400/10' : ''}>
          <p className="text-sm text-slate-700">
            <span className="font-medium capitalize">{cycle.phase} phase</span>
            {cycle.dayInCycle != null && <span className="text-slate-500"> · day {cycle.dayInCycle}</span>}
            {cycle.daysUntilNext != null && (
              <span className="text-slate-500"> · next cycle in {cycle.daysUntilNext}d</span>
            )}
          </p>
          {cycle.lateLuteal && (
            <p className="mt-1 text-xs font-medium text-amber-200">
              Late luteal — fatigue more likely. Consider easing key sessions / avoiding A-races this window.
            </p>
          )}
          <p className="mt-1 text-[11px] text-slate-400">Athlete opted in. Phase shown for planning; dates stay private to her.</p>
        </Card>
      )}
    </div>
  );
}

const STATUS_COLOR: Record<DayStatus, string> = {
  done: 'bg-emerald-500',
  partial: 'bg-amber-400',
  missed: 'bg-rose-500',
  upcoming: 'bg-slate-200',
  rest: 'bg-slate-100 ring-1 ring-inset ring-slate-200',
  extra: 'bg-sky-400',
};

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${color}`} /> {label}
    </span>
  );
}

const PRIORITY_STYLE: Record<string, string> = {
  goal: 'bg-violet-400/15 text-violet-200 ring-violet-400/30',
  tune_up: 'bg-sky-400/15 text-sky-200 ring-sky-400/30',
  training: 'bg-slate-100 text-slate-600 ring-slate-200',
  other: 'bg-slate-100 text-slate-500 ring-slate-200',
};

function RacePriorityBadge({ priority, purpose }: { priority: string; purpose?: string | null }) {
  // Prefer the coach-facing purpose label; colour by the engine priority.
  const label = purpose ? purposeLabel(purpose) : priority === 'tune_up' ? 'tune-up' : priority;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide ring-1 ring-inset ${
        PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.other
      }`}
    >
      {label}
    </span>
  );
}

function fmtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function raceGoal(r: {
  goalType: string;
  targetTimeSeconds: number | null;
  targetPaceSecPerKm: number | null;
}): string {
  const parts: string[] = [];
  if (r.targetTimeSeconds) parts.push(`goal ${fmtTime(r.targetTimeSeconds)}`);
  if (r.targetPaceSecPerKm) parts.push(`${secPerKmToMinPerMile(r.targetPaceSecPerKm)}/mi`);
  return parts.length ? parts.join(' · ') : r.goalType === 'effort' ? 'effort' : '—';
}

function SignalCell({
  label,
  series,
  stroke,
}: {
  label: string;
  series: { day: string; value: number | null }[];
  stroke: string;
}) {
  const last = [...series].reverse().find((s) => s.value != null)?.value ?? null;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <span className="text-sm tabular-nums text-slate-800">{last == null ? '—' : last.toFixed(1)}</span>
      </div>
      <div className="mt-1">
        <Sparkline values={series.map((s) => s.value)} width={180} height={32} stroke={stroke} />
      </div>
    </div>
  );
}
