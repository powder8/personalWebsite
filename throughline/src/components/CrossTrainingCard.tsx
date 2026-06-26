/**
 * Credit recent cross-training (bike/swim/strength). A ride builds the aerobic
 * engine with no impact — so we acknowledge it and count it toward consistency,
 * while being explicit that it doesn't move run paces. Pure markup.
 */
import type { CrossTrainingSummary } from '@/server/weeklyVolume';

const SPORT: Record<string, { icon: string; label: string }> = {
  bike: { icon: '🚴', label: 'cycling' },
  swim: { icon: '🏊', label: 'swimming' },
  strength: { icon: '💪', label: 'strength' },
  cross_train: { icon: '🔁', label: 'cross-training' },
  other: { icon: '🤸', label: 'training' },
};

function fmtDuration(min: number): string {
  if (min <= 0) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function CrossTrainingCard({ summary }: { summary: CrossTrainingSummary }) {
  if (summary.sessions === 0) return null;
  const icons = summary.sports.map((s) => SPORT[s]?.icon ?? '🔁').join(' ');
  const label =
    summary.sports.length === 1 ? SPORT[summary.sports[0]]?.label ?? 'cross-training' : 'cross-training';
  const dur = fmtDuration(summary.minutes);

  return (
    <div className="rounded-2xl bg-emerald-400/10 p-4 ring-1 ring-inset ring-emerald-400/20">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icons}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
          Cross-training · last 2 weeks
        </span>
      </div>
      <div className="mt-1 text-sm font-semibold text-white">
        {summary.sessions} {label} session{summary.sessions === 1 ? '' : 's'}
        {dur && <span className="font-normal text-slate-400"> · {dur}</span>}
        {summary.miles > 0 && <span className="font-normal text-slate-400"> · {summary.miles} mi</span>}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        Nice aerobic work — this builds your engine with none of the pounding. It counts toward your consistency and
        weekly load; it just doesn’t set your run paces (cycling fitness ≠ running economy).
      </p>
    </div>
  );
}
