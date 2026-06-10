/**
 * Runna-style 7-day week strip: one chip per day with the session type color,
 * distance, and a strong "today" treatment. Pure server markup.
 */
import type { PortalSession } from '@/server/portal';

export const SESSION_COLOR: Record<string, string> = {
  recovery: 'bg-teal-400',
  easy: 'bg-sky-400',
  maintenance: 'bg-cyan-400',
  marathon: 'bg-indigo-400',
  long: 'bg-violet-400',
  tempo: 'bg-amber-400',
  threshold: 'bg-amber-500',
  intervals: 'bg-rose-400',
  race: 'bg-lime-400',
  cross_train: 'bg-emerald-400',
  rest: 'bg-slate-200',
};

export const SESSION_LABEL: Record<string, string> = {
  recovery: 'Recovery',
  easy: 'Easy run',
  maintenance: 'Steady run',
  marathon: 'Marathon pace',
  long: 'Long run',
  tempo: 'Tempo',
  threshold: 'Threshold',
  intervals: 'Intervals',
  race: 'Race',
  cross_train: 'Cross-train',
  rest: 'Rest',
};

/**
 * Where to run each session type. Quality/timed work wants flat ground so the
 * clock means something; easy days are where hills earn their keep.
 */
export const SESSION_TERRAIN: Record<string, string> = {
  intervals: 'Flat ground or a track — keep the reps honest.',
  threshold: 'Flat, uninterrupted route — save the hills for easy days.',
  tempo: 'Flat, uninterrupted route — save the hills for easy days.',
  marathon: 'Flat to gently rolling — rehearse goal-race terrain.',
  race: 'Flat, fast course if the clock matters.',
  long: 'Rolling is fine — time on feet beats pace today.',
  easy: 'Anywhere you enjoy — hills welcome.',
  recovery: 'Soft and flat — easy underfoot.',
  maintenance: 'Steady anywhere — gentle rolling is fine.',
};

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function dowIndex(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return ((Math.floor(Date.UTC(y, m - 1, d) / 86400000) % 7) + 3) % 7; // 0 = Mon
}
const mi = (m: number | null) => (m == null || m <= 0 ? null : (m / 1609.344).toFixed(m >= 16093 ? 0 : 1));

export function WeekStrip({ sessions, today }: { sessions: PortalSession[]; today: string }) {
  // Slot sessions into Mon..Sun (first session wins per day; rest days empty).
  const byDow: (PortalSession | null)[] = Array(7).fill(null);
  const dayByDow: (string | null)[] = Array(7).fill(null);
  for (const s of sessions) {
    const i = dowIndex(s.day);
    if (!byDow[i]) byDow[i] = s;
    dayByDow[i] = s.day;
  }
  const todayDow = dowIndex(today);

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {DOW.map((label, i) => {
        const s = byDow[i];
        const isToday = dayByDow[i] === today || (dayByDow[i] == null && i === todayDow);
        const type = s?.sessionType ?? 'rest';
        const dist = s ? mi(s.distanceMeters) : null;
        return (
          <div
            key={i}
            className={`flex flex-col items-center gap-1 rounded-2xl px-1 py-2 ${
              isToday ? 'bg-lime-300 text-[#0c1018] shadow-md' : 'bg-slate-50 text-slate-600'
            }`}
          >
            <span className={`text-[10px] font-semibold uppercase ${isToday ? 'text-[#0c1018]/60' : 'text-slate-400'}`}>
              {label}
            </span>
            <span className={`h-2 w-2 rounded-full ${SESSION_COLOR[type] ?? 'bg-slate-300'}`} />
            <span className={`text-[11px] font-semibold tabular-nums ${isToday ? 'text-[#0c1018]' : 'text-slate-700'}`}>
              {dist ?? '·'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
