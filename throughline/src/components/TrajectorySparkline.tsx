import type { GoalProgress } from '@/server/goalProgressLogic';

/**
 * A quick "are you trending the right way?" sparkline for the goal card — the
 * fitness (CTL) curve over the last ~12 weeks, coloured by direction. Pure
 * markup (inline SVG), so it renders on the server inside the dark goal hero.
 */
const COLOR: Record<GoalProgress['direction'], { stroke: string; text: string; fill: string }> = {
  climbing: { stroke: '#a3e635', text: 'text-lime-300', fill: 'rgba(163,230,53,0.16)' }, // lime
  holding: { stroke: '#fbbf24', text: 'text-amber-300', fill: 'rgba(251,191,36,0.14)' }, // amber
  declining: { stroke: '#fb7185', text: 'text-rose-300', fill: 'rgba(251,113,133,0.14)' }, // rose
};

export function TrajectorySparkline({ progress }: { progress: GoalProgress }) {
  const c = COLOR[progress.direction];
  const pts = progress.spark;
  const W = 132;
  const H = 36;
  const P = 3; // padding so the stroke isn't clipped

  // Normalize to the viewBox; a flat series draws a centred line.
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const n = pts.length;
  const x = (i: number) => (n <= 1 ? W / 2 : P + (i * (W - 2 * P)) / (n - 1));
  const y = (v: number) => H - P - ((v - min) / span) * (H - 2 * P);
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${P},${H - P} ${line} ${x(n - 1).toFixed(1)},${H - P}`;

  return (
    <div className="flex items-center gap-3">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="shrink-0" role="img" aria-label={progress.label}>
        <polygon points={area} fill={c.fill} stroke="none" />
        <polyline points={line} fill="none" stroke={c.stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {n > 0 && <circle cx={x(n - 1)} cy={y(pts[n - 1])} r={2.5} fill={c.stroke} />}
      </svg>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${c.text}`}>{progress.label}</p>
        <p className="text-xs text-white/50">
          {progress.onTrack ? 'On track — keep the trend going.' : 'Build the trend back up to close on your goal.'}
        </p>
      </div>
    </div>
  );
}
