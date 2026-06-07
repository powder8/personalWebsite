import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { eq } from 'drizzle-orm';
import { athletes } from '@/db/schema';
import { getSeasonPlan, getUpcomingWeeks } from '@/server/season';
import { SeasonForm } from '@/components/SeasonForm';
import { Card } from '@/components/ui';
import { TODAY } from '@/server/console';
import { secPerKmToMinPerMile } from '@/engine/plan';

export const dynamic = 'force-dynamic';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function miles(m: number | null): number {
  return m == null ? 0 : Math.round((m / 1609.344) * 10) / 10;
}
function pace(sec: number | null): string {
  return sec == null ? '' : `${secPerKmToMinPerMile(sec)}/mi`;
}
function dow(day: string): string {
  const [y, mo, d] = day.split('-').map(Number);
  return DOW[((Math.floor(Date.UTC(y, mo - 1, d) / 86400000) % 7) + 3) % 7];
}

const PHASE_COLOR: Record<string, string> = {
  base: 'bg-slate-300',
  build: 'bg-sky-400',
  peak: 'bg-violet-400',
  taper: 'bg-amber-400',
};

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, id)).limit(1);
  if (!athlete) notFound();

  const { weeks, races } = await getSeasonPlan(db, id);
  const upcoming = await getUpcomingWeeks(db, id, TODAY, 4);
  const racesByWeek = new Map<string, typeof races>();
  for (const r of races) {
    for (const w of weeks) {
      if (r.date >= w.weekStart && r.date <= w.weekEnd) {
        racesByWeek.set(w.weekStart, [...(racesByWeek.get(w.weekStart) ?? []), r]);
      }
    }
  }
  const maxVol = Math.max(1, ...weeks.map((w) => miles(w.weeklyTargetMeters)));

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/athletes/${id}`} className="text-sm text-sky-700 hover:underline">
          ← {athlete.fullName}
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-slate-900">Season plan</h1>
      </div>

      {weeks.length > 0 ? (
        <Card title={`${weeks.length}-week build`}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1 font-medium">Week</th>
                <th className="py-1 font-medium">Phase</th>
                <th className="py-1 font-medium">Volume</th>
                <th className="py-1 font-medium">Races</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {weeks.map((w) => {
                const v = miles(w.weeklyTargetMeters);
                const wkRaces = racesByWeek.get(w.weekStart) ?? [];
                return (
                  <tr key={w.weekStart}>
                    <td className="py-1.5 pr-2 text-slate-600">{w.weekStart}</td>
                    <td className="py-1.5 pr-2">
                      <span className="capitalize text-slate-700">{w.phase}</span>
                      <span className="ml-1 text-xs text-slate-400">c{w.cycle}</span>
                    </td>
                    <td className="py-1.5 pr-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-32 rounded bg-slate-100">
                          <div
                            className={`h-2 rounded ${PHASE_COLOR[w.phase ?? ''] ?? 'bg-slate-300'}`}
                            style={{ width: `${(v / maxVol) * 100}%` }}
                          />
                        </div>
                        <span className="tabular-nums text-slate-600">{v} mi</span>
                      </div>
                    </td>
                    <td className="py-1.5">
                      {wkRaces.map((r) => (
                        <span
                          key={r.id}
                          className={`mr-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                            r.priority === 'goal'
                              ? 'bg-violet-100 text-violet-800'
                              : r.priority === 'tune_up'
                                ? 'bg-sky-100 text-sky-800'
                                : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {r.name}
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-slate-500">No plan yet — set up the season below to generate one.</p>
        </Card>
      )}

      {upcoming.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">Next few weeks</h2>
          {upcoming.map((w) => (
            <Card
              key={w.planId}
              title={`Week of ${w.weekStart} · ${w.phase ?? ''}${w.status === 'draft' ? ' (draft)' : ''}`}
            >
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {w.sessions.map((s) => {
                    const isToday = s.day === TODAY;
                    return (
                      <tr key={s.id} className={isToday ? 'bg-sky-50' : ''}>
                        <td className="w-12 px-2 py-1.5 font-medium text-slate-500">{dow(s.day)}</td>
                        <td className="w-16 px-2 py-1.5 text-slate-700">
                          {s.targetDistanceMeters ? `${miles(s.targetDistanceMeters)} mi` : '—'}
                        </td>
                        <td className="px-2 py-1.5">
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
                          {s.description && <p className="text-xs text-slate-500">{s.description}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}

      <Card title="Set up / regenerate season">
        <p className="mb-3 text-xs text-slate-500">
          Enter the goal race, a recent race for fitness, weekly volume, and any key races. Generating
          replaces the current races and plan.
        </p>
        <SeasonForm athleteId={id} />
      </Card>
    </div>
  );
}
