/**
 * Prescriptive workout structure — warm-up / reps / cool-down as discrete
 * steps (Runna-style), from the engine's structured segments. Pure server
 * markup; works on light and dark ("onDark") surfaces.
 */
import type { PortalSegment } from '@/server/portal';
import { segmentHeadline } from '@/engine/plan/segmentDisplayLogic';

const ROLE_LABEL: Record<string, string> = {
  warmup: 'Warm-up',
  work: 'Work',
  recovery_jog: 'Recovery',
  recovery_spin: 'Recovery',
  cooldown: 'Cool-down',
};

const ROLE_DOT: Record<string, string> = {
  warmup: 'bg-sky-400',
  work: 'bg-rose-400',
  recovery_jog: 'bg-teal-400',
  recovery_spin: 'bg-teal-400',
  cooldown: 'bg-slate-400',
};

/**
 * Headline for a segment — discipline-aware, inferred from the segment's own
 * fields: run "5 × 1 mi", bike "5 × 8 min @ 228–263 W", swim
 * "11 × 100 m @ 1:16–1:20/100m". Running output is unchanged.
 */
const headline = (s: PortalSegment): string => segmentHeadline(s);

export function SegmentList({ segments, onDark = false }: { segments: PortalSegment[]; onDark?: boolean }) {
  const label = onDark ? 'text-white/85' : 'text-slate-700';
  const sub = onDark ? 'text-slate-400' : 'text-slate-500';
  const rail = onDark ? 'border-white/10' : 'border-slate-100';
  return (
    <ol className={`mt-2 space-y-0 border-l-2 pl-3 ${rail}`}>
      {segments.map((s, i) => (
        <li key={i} className="relative py-1.5">
          <span
            className={`absolute -left-[19px] top-2.5 h-2.5 w-2.5 rounded-full ring-2 ${
              onDark ? 'ring-[#131a2c]' : 'ring-card'
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
