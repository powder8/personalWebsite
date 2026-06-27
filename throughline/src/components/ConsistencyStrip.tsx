/**
 * Positive-reinforcement consistency strip: streak + a few stats the athlete
 * should feel good about. Pure markup; data from server/consistency.ts.
 */
import type { ConsistencyStats } from '@/server/consistencyLogic';

function Stat({ value, label, sublabel, accent }: { value: string; label: string; sublabel?: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={`text-xl font-extrabold tracking-tight tabular-nums ${accent ? 'text-lime-300' : 'text-white'}`}>
        {value}
      </div>
      <div className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      {sublabel && <div className="truncate text-[9px] text-slate-500">{sublabel}</div>}
    </div>
  );
}

export function ConsistencyStrip({ stats }: { stats: ConsistencyStats }) {
  return (
    <div className="rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-5 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold tracking-tight text-white">{stats.headline}</p>
        {stats.longestStreak > stats.currentStreak && stats.longestStreak >= 4 && (
          <span className="text-[11px] text-slate-400">best {stats.longestStreak}d</span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-3">
        <Stat value={`${stats.currentStreak}`} label="day streak" sublabel="runs + XT" accent={stats.currentStreak >= 3} />
        <Stat
          value={stats.weeksTracked > 0 ? `${stats.weeksHit}/${stats.weeksTracked}` : '—'}
          label="wks on plan"
          sublabel="≥80% run miles"
        />
        <Stat value={`${stats.runs28d}`} label="runs · 4 wks" />
        <Stat value={stats.adherence28dPct != null ? `${stats.adherence28dPct}%` : '—'} label="on plan" />
      </div>
      {stats.crossTrain28d > 0 && (
        <p className="mt-3 border-t border-white/10 pt-2 text-[11px] text-slate-400">
          + {stats.crossTrain28d} cross-training day{stats.crossTrain28d === 1 ? '' : 's'} in the last 4 weeks — counts
          toward your streak too.
        </p>
      )}
    </div>
  );
}
