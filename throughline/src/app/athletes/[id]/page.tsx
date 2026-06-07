import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAthleteDetail, TODAY, type Band } from '@/server/console';
import { BandBadge, Card, Sparkline } from '@/components/ui';
import { secPerKmToMinPerMile } from '@/engine/plan';

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
  const { id } = await params;
  const detail = await getAthleteDetail(id);
  if (!detail) notFound();

  const { athlete, readinessToday, readinessHistory, currentWeek, checkIns, notes, injuries, races, signals } =
    detail;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/" className="text-sm text-sky-700 hover:underline">
          ← Roster
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-900">{athlete.fullName}</h1>
          <div className="text-right text-sm text-slate-500">
            {athlete.goalRace}
            {athlete.goalRaceDate && <span> · {athlete.goalRaceDate}</span>}
          </div>
        </div>
      </div>

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
                  <RacePriorityBadge priority={r.priority} />
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
      </Card>

      {/* Signals vs baseline */}
      <Card title="Signals (28 days)">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SignalCell label="HRV (ms)" series={signals.hrv} stroke="#0ea5e9" />
          <SignalCell label="Resting HR (bpm)" series={signals.restingHr} stroke="#ef4444" />
          <SignalCell label="Sleep (hrs)" series={signals.sleepHours} stroke="#8b5cf6" />
        </div>
      </Card>

      {/* Current plan week */}
      <Card title={currentWeek ? `This week — ${currentWeek.plan.phase ?? ''} (cycle ${currentWeek.plan.cycle ?? '—'})` : 'This week'}>
        {currentWeek ? (
          <>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {currentWeek.sessions.map((s) => {
                  const isToday = s.day === TODAY;
                  return (
                    <tr key={s.id} className={isToday ? 'bg-sky-50' : ''}>
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
                        <p className="text-xs text-slate-500">{s.description}</p>
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
    </div>
  );
}

const PRIORITY_STYLE: Record<string, string> = {
  goal: 'bg-violet-100 text-violet-800 ring-violet-200',
  tune_up: 'bg-sky-100 text-sky-800 ring-sky-200',
  training: 'bg-slate-100 text-slate-600 ring-slate-200',
  other: 'bg-slate-100 text-slate-500 ring-slate-200',
};

function RacePriorityBadge({ priority }: { priority: string }) {
  const label = priority === 'tune_up' ? 'tune-up' : priority;
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
