/**
 * The evidence behind body status: each vital against the athlete's own normal
 * range, a six-week strain timeline with episodes marked, and past episodes.
 * Pure markup (server component).
 */
import type { BodyStatusView, VitalView } from '@/server/bodyStatus';

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const KIND: Record<string, string> = { illness: 'Possible illness', overreaching: 'Fatigue from training', under_recovered: 'Short on recovery', strain: 'Unexplained strain' };

const STATE_TEXT: Record<VitalView['state'], { label: string; cls: string }> = {
  ok: { label: 'In range', cls: 'text-emerald-300' },
  off: { label: 'Off', cls: 'text-amber-300' },
  very_off: { label: 'Well outside', cls: 'text-rose-300' },
  forming: { label: 'Baseline forming', cls: 'text-slate-500' },
};

/** 42-day line with the athlete's normal band shaded and episode days marked. */
function RangeSpark({ v }: { v: VitalView }) {
  const W = 220;
  const H = 44;
  if (v.series.length < 3) return <div className="h-11" />;
  const vals = v.series.map((p) => p.value);
  const lo = Math.min(...vals, v.lo ?? Infinity);
  const hi = Math.max(...vals, v.hi ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (v.series.length - 1)) * W;
  const y = (val: number) => H - 3 - ((val - lo) / span) * (H - 6);
  const d = v.series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-11 w-full" preserveAspectRatio="none" role="img" aria-label={`${v.label}, last ${v.series.length} days`}>
      {v.lo != null && v.hi != null && <rect x={0} width={W} y={y(v.hi)} height={Math.max(2, y(v.lo) - y(v.hi))} fill="rgb(255 255 255 / 0.07)" rx={2} />}
      <path d={d} fill="none" stroke="rgb(203 203 209)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {v.series.map((p, i) => (p.inEpisode ? <circle key={p.day} cx={x(i)} cy={y(p.value)} r={2.2} fill="rgb(251 113 133)" /> : null))}
    </svg>
  );
}

export function BodySignals({ view }: { view: BodyStatusView }) {
  const f = (v: VitalView, n: number | null) => (n == null ? '–' : n.toFixed(v.decimals));
  const maxStrain = Math.max(4, ...view.strain.map((s) => s.value));
  return (
    <section className="rounded-3xl bg-card p-5 ring-1 ring-inset ring-white/[0.06] sm:p-6" aria-label="Your signals">
      <h2 className="text-[17px] font-semibold tracking-tight text-white">Your signals against your normal</h2>
      <p className="mt-1 text-sm text-slate-500">
        Each reading is compared with your own healthy range from the last eight weeks. Days when you were unwell don&apos;t count toward that range.
      </p>

      {view.vitals.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No wearable data yet. Connect Whoop or Garmin in Settings to see this.</p>
      ) : (
        <div className="mt-4 divide-y divide-white/[0.06]">
          {view.vitals.map((v) => (
            <div key={v.key} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-3 sm:grid-cols-[10rem_1fr_auto]">
              <div>
                <div className="text-sm text-slate-500">{v.label}</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-semibold tabular-nums text-white">{f(v, v.value)}</span>
                  <span className="text-xs text-slate-500">{v.unit}</span>
                </div>
              </div>
              <div className="order-last col-span-2 sm:order-none sm:col-span-1">
                <RangeSpark v={v} />
              </div>
              <div className="text-right">
                <div className={`text-sm font-medium ${STATE_TEXT[v.state].cls}`}>{STATE_TEXT[v.state].label}</div>
                {v.usual != null && (
                  <div className="text-xs tabular-nums text-slate-500">
                    usual {f(v, v.lo)}–{f(v, v.hi)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {view.vitals.length > 0 && <p className="mt-2 text-xs text-slate-500">Shaded band: your normal range. Red dots: days inside an episode.</p>}

      {view.strain.length >= 7 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-white">Combined strain, last six weeks</h3>
          <p className="mt-0.5 text-xs text-slate-500">All signals in one number. Above the line is unusual for you; several days in a row is what we act on.</p>
          <div className="relative mt-3 flex h-20 items-end gap-[2px]" role="img" aria-label="Daily combined strain">
            <div className="absolute inset-x-0 border-t border-dashed border-white/20" style={{ bottom: `${(1.75 / maxStrain) * 100}%` }} />
            {view.strain.map((s) => (
              <div
                key={s.day}
                title={`${fmtDay(s.day)}: ${s.value.toFixed(1)}`}
                className={`flex-1 rounded-sm ${s.inEpisode ? 'bg-rose-400' : s.value >= 1.75 ? 'bg-amber-400' : 'bg-white/20'}`}
                style={{ height: `${Math.max(4, (Math.max(0, s.value) / maxStrain) * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-slate-500">
            <span>{fmtDay(view.strain[0].day)}</span>
            <span>{fmtDay(view.strain[view.strain.length - 1].day)}</span>
          </div>
        </div>
      )}

      {view.load.note && <p className="mt-5 text-sm text-slate-600">{view.load.note}</p>}

      {view.history.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-white">What we have seen</h3>
          <ul className="mt-2 space-y-2">
            {[...view.history].reverse().map((h) => (
              <li key={h.startedOn} className="flex items-baseline justify-between gap-3 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm">
                <span className="text-white">
                  {fmtDay(h.startedOn)} to {fmtDay(h.endedOn)}
                  <span className="text-slate-500"> · {KIND[h.kind] ?? h.kind}</span>
                </span>
                <span className="shrink-0 tabular-nums text-slate-500">{h.days} days</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
