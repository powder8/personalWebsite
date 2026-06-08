/**
 * Shared insights rendering — used identically by the coach view
 * (/athletes/[id]/insights) and the athlete view (/me/[id]/insights). Athletes
 * on automated plans see exactly what the coach sees, so they can understand
 * their own builds. Pure presentational; takes a non-null TrainingInsights.
 */
import type { TrainingInsights } from '@/server/insights';
import { Card } from '@/components/ui';

export function InsightsView({ insights }: { insights: TrainingInsights }) {
  return (
    <>
      {insights.suggestions.length > 0 && (
        <Card title="Suggestions" className="border-sky-200">
          <ul className="space-y-2 text-sm">
            {insights.suggestions.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                    s.basis === 'science' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {s.basis === 'science' ? 'science' : 'your history'}
                </span>
                <span className="text-slate-700">{s.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-400">
            Drawn from your most productive training blocks and established training science — to weigh,
            not follow blindly.
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

      {insights.buildProfile && insights.builds.length > 0 && (
        <Card title="Your most productive blocks" className="border-emerald-200">
          <p className="text-sm text-slate-700">
            The pattern across your{' '}
            <span className="font-medium">{insights.buildProfile.count}</span> biggest 8-week fitness
            builds — what they had in common, not a single block:
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Typical volume" value={`${insights.buildProfile.medianWeeklyMiles}`} unit="mi/week" emphasis />
            <Tile label="Frequency" value={`${insights.buildProfile.medianRunDaysPerWeek}`} unit="run-days/wk" />
            <Tile
              label="Quality"
              value={insights.buildProfile.medianQualityPerWeek != null ? `${insights.buildProfile.medianQualityPerWeek}` : '—'}
              unit="hard sessions/wk"
            />
            <Tile
              label="Long runs"
              value={`${insights.buildProfile.blocksWithLongRuns}/${insights.buildProfile.count}`}
              unit="blocks"
            />
          </div>
          <div className="mt-4 overflow-hidden rounded border border-slate-100">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-2 py-1 font-medium">Block (8 wks ending)</th>
                  <th className="px-2 py-1 font-medium">Fitness gain</th>
                  <th className="px-2 py-1 font-medium">Volume</th>
                  <th className="px-2 py-1 font-medium">Mix</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {insights.builds.map((b) => (
                  <tr key={b.toDay}>
                    <td className="px-2 py-1.5 text-slate-600">{b.toDay}</td>
                    <td className="px-2 py-1.5 font-medium text-emerald-700">+{b.ctlGain} CTL</td>
                    <td className="px-2 py-1.5 text-slate-700">{b.mix.avgWeeklyMiles} mi/wk</td>
                    <td className="px-2 py-1.5 text-slate-500">
                      {b.mix.gpsShare >= 50
                        ? `${b.mix.easyPct}% easy / ${b.mix.qualityPct}% quality · ${b.mix.longRuns} long`
                        : `${b.mix.longRuns} long · mix n/a (logged)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {insights.recent?.hasData && (
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
              Lately (6 wks): {insights.recent.avgWeeklyMiles} mi/wk · ~{insights.recent.easyPct}% easy / ~
              {insights.recent.qualityPct}% quality · {insights.recent.qualityPerWeek} hard/wk ·{' '}
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
          Associations from your own data (n-of-1) — patterns to weigh, not causes. Recovery factors
          (sleep, HRV, stress) join here as wearable data is connected.
        </p>
      </Card>
    </>
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
