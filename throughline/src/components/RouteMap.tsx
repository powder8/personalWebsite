/**
 * Minimal route map: the run's polyline rendered as an SVG path (no tile
 * server, no keys) — Runna-style clean line on a subtle panel, with start
 * (lime) and finish (dark) markers. Pure server component.
 */
import { decodePolyline } from '@/lib/polyline';

const W = 640;
const H = 320;
const PAD = 18;

export function RouteMap({ polyline }: { polyline: string }) {
  const pts = decodePolyline(polyline);
  if (pts.length < 2) return null;

  // Equirectangular projection, longitude scaled by cos(mid-latitude) so the
  // route's shape isn't stretched.
  const lats = pts.map((p) => p[0]);
  const midLat = ((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180);
  const k = Math.cos(midLat);
  const xs = pts.map((p) => p[1] * k);
  const ys = pts.map((p) => -p[0]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1e-6;
  const spanY = maxY - minY || 1e-6;
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const offX = (W - spanX * scale) / 2;
  const offY = (H - spanY * scale) / 2;
  const px = (i: number) => offX + (xs[i] - minX) * scale;
  const py = (i: number) => offY + (ys[i] - minY) * scale;

  const d = pts.map((_, i) => `${i === 0 ? 'M' : 'L'} ${px(i).toFixed(1)} ${py(i).toFixed(1)}`).join(' ');
  const last = pts.length - 1;

  return (
    <div className="overflow-hidden rounded-2xl bg-slate-100">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Run route map">
        {/* subtle grid for spatial feel */}
        {Array.from({ length: 7 }, (_, i) => (
          <line key={`v${i}`} x1={(i + 1) * (W / 8)} x2={(i + 1) * (W / 8)} y1={0} y2={H} stroke="#e2e8f0" strokeWidth={1} />
        ))}
        {Array.from({ length: 3 }, (_, i) => (
          <line key={`h${i}`} x1={0} x2={W} y1={(i + 1) * (H / 4)} y2={(i + 1) * (H / 4)} stroke="#e2e8f0" strokeWidth={1} />
        ))}
        {/* route */}
        <path d={d} fill="none" stroke="#0f172a" strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.15} transform="translate(0 2)" />
        <path d={d} fill="none" stroke="#4f46e5" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        {/* start + finish */}
        <circle cx={px(0)} cy={py(0)} r={6} fill="#a3e635" stroke="#fff" strokeWidth={2.5} />
        <circle cx={px(last)} cy={py(last)} r={6} fill="#0f172a" stroke="#fff" strokeWidth={2.5} />
      </svg>
    </div>
  );
}
