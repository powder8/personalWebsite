/** Small presentational helpers for the console. Pure server components. */
import type { Band } from '@/server/console';

const BAND_STYLES: Record<Band, string> = {
  easy: 'bg-amber-100 text-amber-800 ring-amber-200',
  normal: 'bg-slate-100 text-slate-700 ring-slate-200',
  go: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
};

export function BandBadge({ band, score }: { band: Band | null; score?: number | null }) {
  if (!band) return <span className="text-slate-400">—</span>;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BAND_STYLES[band]}`}
    >
      {band}
      {score != null && <span className="opacity-60">· {score}</span>}
    </span>
  );
}

export function Flag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
      {children}
    </span>
  );
}

/** Tiny inline SVG sparkline (no client JS). */
export function Sparkline({
  values,
  width = 120,
  height = 28,
  stroke = '#0ea5e9',
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  const pts = values.filter((v): v is number => v != null);
  if (pts.length < 2) return <span className="text-xs text-slate-400">no data</span>;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = width / (pts.length - 1);
  const d = pts
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Card({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)] ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>}
      {children}
    </section>
  );
}
