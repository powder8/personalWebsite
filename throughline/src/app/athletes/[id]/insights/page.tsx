import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { athletes } from '@/db/schema';
import { getTrainingInsights } from '@/server/insights';
import { Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function InsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const [athlete] = await db.select().from(athletes).where(eq(athletes.id, id)).limit(1);
  if (!athlete) notFound();
  const insights = await getTrainingInsights(id);

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/athletes/${id}`} className="text-sm text-sky-700 hover:underline">
          ← {athlete.fullName}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Insights</h1>
        <p className="text-sm text-slate-500">
          Patterns from {athlete.fullName.split(' ')[0]}’s own training history — observations to
          discuss, not prescriptions.
        </p>
      </div>

      {!insights ? (
        <Card>
          <p className="text-sm text-slate-500">
            Not enough training history yet. Insights appear once there’s a meaningful run history
            (connect Strava or import a log).
          </p>
        </Card>
      ) : (
        <>
          {insights.suggestions.length > 0 && (
            <Card title="Suggestions" className="border-sky-200">
              <ul className="space-y-2 text-sm">
                {insights.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        s.basis === 'science'
                          ? 'bg-violet-100 text-violet-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {s.basis === 'science' ? 'science' : 'your history'}
                    </span>
                    <span className="text-slate-700">{s.text}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-slate-400">
                Suggestions for the coach to weigh — drawn from this athlete’s most productive blocks
                and established training science.
              </p>
            </Card>
          )}

          <Card title="History">
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <Stat label="Span" value={`${insights.span.fromDay} → ${insights.span.toDay}`} />
              <Stat label="Runs" value={`${insights.span.runs}`} />
              <Stat label="Total" value={`${insights.span.totalMiles.toLocaleString()} mi`} />
              <Stat label="Peak fitness (CTL)" value={`${insights.peak.ctl}`} sub={insights.peak.day} />
            </div>
          </Card>

          {insights.bestBuild && (
            <Card title="Your biggest build" className="border-emerald-200">
              <p className="text-sm text-slate-700">
                The <span className="font-medium">{insights.bestBuild.weeks}-week</span> block ending{' '}
                <span className="font-medium">{insights.bestBuild.toDay}</span> drove your largest
                fitness gain.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile label="Fitness gain" value={`+${insights.bestBuild.ctlGain}`} unit="CTL" emphasis />
                <Tile label="Volume" value={`${insights.bestBuild.mix.avgWeeklyMiles}`} unit="mi/week" />
                <Tile label="Frequency" value={`${insights.bestBuild.mix.runDaysPerWeek}`} unit="run-days/wk" />
                <Tile label="Longest run" value={`${insights.bestBuild.longestRunMiles}`} unit="mi" />
              </div>
              <div className="mt-3">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Workout mix
                </div>
                {insights.bestBuild.mix.gpsShare >= 50 ? (
                  <>
                    <MixBar mix={insights.bestBuild.mix} />
                    <p className="mt-2 text-xs text-slate-500">
                      ~{insights.bestBuild.mix.easyPct}% easy · ~{insights.bestBuild.mix.qualityPct}% quality
                      (≈{insights.bestBuild.mix.qualityPerWeek} hard/wk) · {insights.bestBuild.mix.longRuns} long
                      runs.
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">
                    {insights.bestBuild.mix.longRuns} long runs. Intensity mix unavailable — only{' '}
                    {insights.bestBuild.mix.gpsShare}% of these runs came from GPS (a logged era; manual
                    logs hide intensity). Mix is precise for GPS/Strava data.
                  </p>
                )}
              </div>
              {insights.recent?.hasData && (
                <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  Lately (6 wks): {insights.recent.avgWeeklyMiles} mi/wk · ~{insights.recent.easyPct}% easy
                  / ~{insights.recent.qualityPct}% quality · {insights.recent.qualityPerWeek} hard/wk ·{' '}
                  {insights.recent.longRuns} long runs.
                </p>
              )}
            </Card>
          )}

          <Card title="Observations">
            <ul className="space-y-2 text-sm text-slate-700">
              {insights.observations.map((o, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-slate-300">•</span>
                  <span>{o}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
              Associations from one athlete’s data (n-of-1) — patterns to weigh, not causes. Recovery
              factors (sleep, HRV, stress) will join here as wearable data is connected.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

function MixBar({ mix }: { mix: { easyPct: number; qualityPct: number } }) {
  const moderate = Math.max(0, 100 - mix.easyPct - mix.qualityPct);
  return (
    <div className="flex h-3 w-full overflow-hidden rounded bg-slate-100">
      <div className="bg-sky-400" style={{ width: `${mix.easyPct}%` }} title={`easy ${mix.easyPct}%`} />
      <div className="bg-slate-300" style={{ width: `${moderate}%` }} title={`moderate ${moderate}%`} />
      <div className="bg-rose-400" style={{ width: `${mix.qualityPct}%` }} title={`quality ${mix.qualityPct}%`} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="font-medium tabular-nums text-slate-800">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function Tile({ label, value, unit, emphasis }: { label: string; value: string; unit: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${emphasis ? 'bg-emerald-50' : 'bg-slate-50'}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${emphasis ? 'text-emerald-700' : 'text-slate-800'}`}>
        {value}
      </div>
      <div className="text-xs text-slate-400">{unit}</div>
    </div>
  );
}
