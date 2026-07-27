/**
 * "Recovery & body" card — how the body is responding to training and life.
 * Headlines Whoop's recovery score, then HRV / resting HR / sleep each read
 * against the athlete's own baseline. Pure markup; data from server/recovery.ts.
 */
import type { RecoverySnapshot, Trend } from '@/server/recovery';
import type { ReadinessResult } from '@/engine';

const TREND_COLOR: Record<Trend, string> = {
  good: 'text-emerald-300',
  watch: 'text-amber-300',
  low: 'text-rose-300',
  neutral: 'text-slate-300',
};

const BAND_RING: Record<'green' | 'yellow' | 'red', string> = {
  green: 'text-emerald-400',
  yellow: 'text-amber-400',
  red: 'text-rose-400',
};

const BAND_WORD: Record<'green' | 'yellow' | 'red', string> = {
  green: 'Recovered',
  yellow: 'Moderate',
  red: 'Low',
};

function RecoveryRing({ score, band }: { score: number; band: 'green' | 'yellow' | 'red' }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-white/10" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className={BAND_RING[band]}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-extrabold tabular-nums text-white">{score}</span>
        <span className="text-[9px] font-medium uppercase tracking-wide text-slate-400">recovery</span>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  sub,
  trend,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  trend: Trend;
}) {
  return (
    <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-inset ring-white/10">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`text-xl font-bold tabular-nums ${TREND_COLOR[trend]}`}>{value}</span>
        {unit && <span className="text-[11px] text-slate-400">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Sparkline({ series, invert }: { series: { day: string; value: number }[]; invert?: boolean }) {
  if (series.length < 3) return null;
  const vals = series.map((s) => s.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const w = 100;
  const h = 24;
  const step = w / (series.length - 1);
  const pts = series
    .map((s, i) => {
      const norm = (s.value - min) / span; // 0..1
      const y = invert ? norm * h : h - norm * h;
      return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-6 w-full">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-sky-400/70" />
    </svg>
  );
}

/**
 * Factual position of the raw metric vs baseline (never inverted) — the tile's
 * colour already encodes whether that direction is good or bad, so the words
 * must state where the number actually sits (e.g. an elevated resting HR reads
 * "above baseline" in amber, not "below").
 */
function trendLabel(z: number | null): string | undefined {
  if (z == null) return undefined;
  if (z >= 1) return 'well above baseline';
  if (z >= 0.5) return 'above baseline';
  if (z <= -1) return 'well below baseline';
  if (z <= -0.5) return 'below baseline';
  return 'around baseline';
}

export function RecoveryCard({
  snapshot,
  readiness,
}: {
  snapshot: RecoverySnapshot;
  readiness: ReadinessResult | null;
}) {
  const { recoveryScore, recoveryBand } = snapshot;

  return (
    <div className="rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-5 shadow-lg">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold tracking-tight text-white">Recovery &amp; body</p>
        {snapshot.asOf && <span className="text-[11px] text-slate-500">as of {fmtDay(snapshot.asOf)}</span>}
      </div>

      <div className="mt-3 flex items-center gap-4">
        {recoveryScore != null && recoveryBand ? (
          <RecoveryRing score={recoveryScore} band={recoveryBand} />
        ) : null}
        <div className="min-w-0 flex-1">
          {recoveryBand && (
            <div className={`text-lg font-bold tracking-tight ${BAND_RING[recoveryBand]}`}>
              {BAND_WORD[recoveryBand]}
            </div>
          )}
          {readiness?.sentence && (
            <p className="mt-0.5 text-sm leading-snug text-slate-100">{readiness.sentence}</p>
          )}
          {snapshot.n < 14 && (
            <p className="mt-1 text-[11px] text-slate-500">
              Baseline still forming ({snapshot.n} days) — trends sharpen as history builds.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {snapshot.hrvMs != null && (
          <Metric
            label="HRV"
            value={`${snapshot.hrvMs}`}
            unit="ms"
            sub={trendLabel(snapshot.hrvZ)}
            trend={snapshot.hrvTrend}
          />
        )}
        {snapshot.restingHr != null && (
          <Metric
            label="Resting HR"
            value={`${snapshot.restingHr}`}
            unit="bpm"
            sub={trendLabel(snapshot.restingHrZ)}
            trend={snapshot.restingHrTrend}
          />
        )}
        {snapshot.sleepHours != null && (
          <Metric
            label="Sleep"
            value={`${snapshot.sleepHours}`}
            unit="h"
            sub={
              snapshot.sleepPerfPct != null
                ? `${snapshot.sleepPerfPct}% of need`
                : snapshot.remMin != null
                  ? `${snapshot.remMin}m REM`
                  : undefined
            }
            trend={snapshot.sleepTrend}
          />
        )}
      </div>

      {snapshot.hrvSeries.length >= 3 && (
        <div className="mt-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">HRV · last {snapshot.hrvSeries.length} days</div>
          <Sparkline series={snapshot.hrvSeries} />
        </div>
      )}

      <MoreMarkers snapshot={snapshot} />
    </div>
  );
}

/** Secondary markers, tucked behind a native expander. Early-illness / strain signals. */
function MoreMarkers({ snapshot }: { snapshot: RecoverySnapshot }) {
  const rows = [
    snapshot.respiratoryRate != null && { label: 'Respiratory rate', value: `${snapshot.respiratoryRate}`, unit: 'br/min' },
    snapshot.spo2 != null && { label: 'Blood oxygen', value: `${snapshot.spo2}`, unit: '%' },
    snapshot.skinTempCelsius != null && { label: 'Skin temp', value: `${snapshot.skinTempCelsius > 0 ? '+' : ''}${snapshot.skinTempCelsius}`, unit: '°C' },
  ].filter(Boolean) as { label: string; value: string; unit: string }[];
  if (rows.length === 0) return null;

  return (
    <details className="group mt-4 border-t border-white/10 pt-3">
      <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-300">
        <span>More markers</span>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {rows.map((r) => (
          <div key={r.label} className="rounded-xl bg-white/5 p-2.5 ring-1 ring-inset ring-white/10">
            <div className="text-[9px] font-medium uppercase tracking-wide text-slate-500">{r.label}</div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-base font-bold tabular-nums text-slate-200">{r.value}</span>
              <span className="text-[10px] text-slate-500">{r.unit}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
        A jump in resting breathing or skin temp — or a dip in blood oxygen — often shows up a day before you feel a cold coming on.
      </p>
    </details>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDay(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
