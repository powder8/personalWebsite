/**
 * Prescriptive workout structure — warm-up / reps / cool-down as discrete
 * steps (Runna-style), from the engine's structured segments. Pure server
 * markup; works on light and dark ("onDark") surfaces.
 */
import type { PortalSegment } from '@/server/portal';

const ROLE_LABEL: Record<string, string> = {
  warmup: 'Warm-up',
  work: 'Work',
  recovery_jog: 'Recovery',
  cooldown: 'Cool-down',
};

const ROLE_DOT: Record<string, string> = {
  warmup: 'bg-sky-400',
  work: 'bg-rose-400',
  recovery_jog: 'bg-teal-400',
  cooldown: 'bg-slate-400',
};

const mi = (m?: number) => (m == null ? null : (m / 1609.344).toFixed(m >= 1609 ? 1 : 2).replace(/\.00$/, ''));

/** Headline for a segment: "5 × 1 mi" or "2.5 mi". */
function headline(s: PortalSegment): string {
  if (s.reps && s.repMeters) {
    const rep = s.repMeters === 400 ? '400m' : `${mi(s.repMeters)} mi`;
    return `${s.reps} × ${rep}`;
  }
  return s.distanceMeters ? `${mi(s.distanceMeters)} mi` : '';
}

export function SegmentList({ segments, onDark = false }: { segments: PortalSegment[]; onDark?: boolean }) {
  const label = onDark ? 'text-slate-300' : 'text-slate-700';
  const sub = onDark ? 'text-slate-400' : 'text-slate-500';
  const rail = onDark ? 'border-white/10' : 'border-slate-100';
  return (
    <ol className={`mt-2 space-y-0 border-l-2 pl-3 ${rail}`}>
      {segments.map((s, i) => (
        <li key={i} className="relative py-1.5">
          <span
            className={`absolute -left-[19px] top-2.5 h-2.5 w-2.5 rounded-full ring-2 ${
              onDark ? 'ring-slate-900' : 'ring-white'
            } ${ROLE_DOT[s.role] ?? 'bg-slate-300'}`}
          />
          <div className={`text-sm font-semibold ${label}`}>
            {ROLE_LABEL[s.role] ?? s.role}
            <span className="ml-2 font-bold tabular-nums">{headline(s)}</span>
          </div>
          {s.note && <p className={`text-xs ${sub}`}>{s.note}</p>}
        </li>
      ))}
    </ol>
  );
}
