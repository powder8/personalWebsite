/**
 * Performance Management Chart — CTL (fitness), ATL (fatigue), TSB (form).
 * Pure SVG server component, no client JS. CTL is a filled area, ATL an
 * overlaid line (shared load axis); TSB is a separate strip with a zero line
 * (green above = fresh, red below = fatigued).
 */
import type { FitnessFatiguePoint } from '@/engine/types';

const W = 640;
const TOP_H = 130;
const TSB_H = 46;
const GAP = 10;
const H = TOP_H + GAP + TSB_H;

function path(pts: { x: number; y: number }[], close?: { baseY: number }): string {
  if (pts.length === 0) return '';
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  if (close) {
    return `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${close.baseY} L ${pts[0].x.toFixed(1)} ${close.baseY} Z`;
  }
  return line;
}

export function PmcChart({ points }: { points: FitnessFatiguePoint[] }) {
  if (points.length < 2) return <p className="text-sm text-slate-400">Not enough training history to chart.</p>;

  const n = points.length;
  const x = (i: number) => (i / (n - 1)) * W;

  const loadMax = Math.max(...points.map((p) => Math.max(p.ctl, p.atl))) || 1;
  const yTop = (v: number) => TOP_H - (v / loadMax) * (TOP_H - 4) - 2;

  const tsbAbs = Math.max(...points.map((p) => Math.abs(p.tsb))) || 1;
  const tsbMid = TOP_H + GAP + TSB_H / 2;
  const yTsb = (v: number) => tsbMid - (v / tsbAbs) * (TSB_H / 2 - 2);

  const ctlPts = points.map((p, i) => ({ x: x(i), y: yTop(p.ctl) }));
  const atlPts = points.map((p, i) => ({ x: x(i), y: yTop(p.atl) }));
  const tsbPts = points.map((p, i) => ({ x: x(i), y: yTsb(p.tsb) }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" preserveAspectRatio="none" role="img" aria-label="Fitness, fatigue and form chart">
      {/* CTL filled area (fitness) */}
      <path d={path(ctlPts, { baseY: TOP_H })} fill="#0ea5e9" fillOpacity={0.12} stroke="none" />
      <path d={path(ctlPts)} fill="none" stroke="#0ea5e9" strokeWidth={2} strokeLinejoin="round" />
      {/* ATL line (fatigue) */}
      <path d={path(atlPts)} fill="none" stroke="#f97316" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" />

      {/* TSB strip */}
      <line x1={0} x2={W} y1={tsbMid} y2={tsbMid} stroke="#39435c" strokeWidth={1} />
      <path
        d={path(tsbPts, { baseY: tsbMid })}
        fill={points[n - 1].tsb >= 0 ? '#22c55e' : '#ef4444'}
        fillOpacity={0.15}
        stroke="none"
      />
      <path d={path(tsbPts)} fill="none" stroke={points[n - 1].tsb >= 0 ? '#16a34a' : '#dc2626'} strokeWidth={1.5} />
    </svg>
  );
}

export function PmcLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2 w-3 rounded-sm bg-sky-500" /> Fitness (CTL)
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-0 w-3 border-t-2 border-dashed border-orange-500" /> Fatigue (ATL)
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-2 w-3 rounded-sm bg-emerald-500" /> Form (TSB, +fresh / −tired)
      </span>
    </div>
  );
}
