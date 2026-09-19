/**
 * General health tracker — resting HR, HRV, sleep, weight and daily steps in
 * ONE consistent read: current vs the athlete's own baseline, a 12-week
 * sparkline, and a direction that respects what "better" means per metric.
 * Health, not training. Pure markup; data from server/healthTrends.
 */
import type { HealthTrend, HealthMetric } from '@/server/healthTrendLogic';
import type { HealthTrends } from '@/server/healthTrends';

const LABEL: Record<HealthMetric, string> = {
  resting_hr: 'Resting HR',
  hrv: 'HRV',
  sleep: 'Sleep',
  weight: 'Weight',
  steps: 'Daily steps',
};
const EMOJI: Record<HealthMetric, string> = { resting_hr: '❤️', hrv: '📈', sleep: '😴', weight: '⚖️', steps: '👟' };
const WHY: Record<HealthMetric, string> = {
  resting_hr: 'Lower over weeks means a stronger, more efficient heart. A sudden rise usually means fatigue, illness or poor sleep.',
  hrv: 'Higher means better recovered. Judge the trend, never one morning, it swings a lot day to day.',
  sleep: 'Where the training actually sticks. Consistency matters as much as the average.',
  weight: 'Reported without judgement. A drop during a hard block that you did not intend is an early under-fuelling sign.',
  steps: 'Everyday movement outside training. Good for health, and a big walking day is real load on the legs before a long run.',
};

function fmt(t: HealthTrend, v: number | null, units: 'mi' | 'km'): string {
  if (v == null) return '-';
  switch (t.metric) {
    case 'resting_hr': return `${Math.round(v)} bpm`;
    case 'hrv': return `${Math.round(v)} ms`;
    case 'sleep': {
      const h = Math.floor(v);
      const m = Math.round((v - h) * 60);
      return `${h}h ${String(m).padStart(2, '0')}m`;
    }
    case 'weight': return units === 'km' ? `${v.toFixed(1)} kg` : `${(v * 2.20462).toFixed(1)} lb`;
    case 'steps': return Math.round(v).toLocaleString();
  }
}

function tone(t: HealthTrend): string {
  if (t.direction === 'improving') return 'text-lime-300';
  if (t.direction === 'worsening') return 'text-rose-300';
  return 'text-slate-400';
}

function trendLabel(t: HealthTrend): string {
  if (t.deltaPct == null) return 'Building a baseline';
  const pct = `${t.deltaPct > 0 ? '+' : ''}${t.deltaPct}%`;
  switch (t.direction) {
    case 'improving': return `${pct} · improving`;
    case 'worsening': return `${pct} · watch this`;
    case 'up': return `${pct} vs last month`;
    case 'down': return `${pct} vs last month`;
    default: return 'Steady';
  }
}

function Spark({ t }: { t: HealthTrend }) {
  const vals = t.weekly.filter((v): v is number => v != null);
  if (vals.length < 2) return <div className="h-6 w-24 shrink-0" />;
  const W = 96;
  const H = 24;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  // Draw the RAW value. A falling resting HR should look like a falling line —
  // the colour and the word carry the judgement, the shape stays literal.
  const y = (v: number) => H - 2 - ((v - min) / span) * (H - 4);
  const step = W / (t.weekly.length - 1);
  const d = t.weekly
    .map((v, i) => (v == null ? null : `${(i * step).toFixed(1)},${y(v).toFixed(1)}`))
    .filter((s): s is string => s !== null)
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${s}`)
    .join(' ');
  const stroke = t.direction === 'improving' ? '#a3e635' : t.direction === 'worsening' ? '#fb7185' : '#94a3b8';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-6 w-24 shrink-0" aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HealthTrackerCard({ trends, units }: { trends: HealthTrends; units: 'mi' | 'km' }) {
  if (trends.trends.length === 0) return null;
  return (
    <section className="rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-5 shadow-lg">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold tracking-tight text-white">Health tracker</h2>
        <span className="text-[11px] text-slate-500">last 7 days vs the month before · {trends.windowWeeks}-week trend</span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        Your general health signals in one place, each against your own baseline. These describe how you are, they
        never feed the training load.
      </p>
      <div className="mt-3 space-y-2">
        {trends.trends.map((t) => (
          <div key={t.metric} className="rounded-2xl bg-white/5 p-3.5 ring-1 ring-inset ring-white/10">
            <div className="flex items-center gap-3">
              <span aria-hidden className="text-base">{EMOJI[t.metric]}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white">{LABEL[t.metric]}</div>
                <div className="text-[11px] text-slate-400">
                  {t.baseline != null ? `baseline ${fmt(t, t.baseline, units)}` : `${t.days} day${t.days === 1 ? '' : 's'} so far`}
                </div>
              </div>
              <Spark t={t} />
              <div className="shrink-0 text-right">
                <div className="text-lg font-bold tabular-nums text-white">{fmt(t, t.current, units)}</div>
                <div className={`text-[11px] font-medium ${tone(t)}`}>{trendLabel(t)}</div>
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{WHY[t.metric]}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
