import Link from 'next/link';
import type { RecoveryInsights } from '@/server/recovery';
import type { GoalProgress } from '@/server/goalProgressLogic';

export function DailyBriefing({ firstName, today, recovery, checkedIn, goalName, daysAway, progress, adherence }: {
  firstName: string; today: string; recovery: RecoveryInsights; checkedIn: boolean;
  goalName: string | null; daysAway: number | null; progress: GoalProgress | null; adherence: number | null;
}) {
  const low = recovery.readiness?.band === 'easy' || recovery.pattern.kind === 'strained';
  const title = low ? 'Make room to recover.' : checkedIn ? 'Your day is ready.' : 'Start with you, then the plan.';
  return <section className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-950/70 via-[#141b2e] to-[#10141f] p-5 sm:p-6" aria-labelledby="daily-heading">
    <p className="text-xs font-medium uppercase tracking-widest text-emerald-200">Your daily compass · {today}</p>
    <h1 id="daily-heading" className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">{firstName}, {title.charAt(0).toLowerCase() + title.slice(1)}</h1>
    <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-700">{low
      ? 'Protect the next few weeks, not just this workout. Check your recovery below and choose an easier day if you need one.'
      : recovery.readiness?.sentence ?? 'Check how your body is responding, see today’s work, and keep the long-term goal in view.'}</p>
    <div className="mt-5 grid grid-cols-3 gap-2">
      <Link href="#recovery" className="rounded-2xl bg-white/5 p-3 hover:bg-white/10">
        <span className="block text-xs text-slate-500">Body</span>
        <span className="mt-1 block text-sm font-semibold text-white">{low ? 'Needs care' : recovery.readiness ? 'Steady today' : 'Check in'}</span>
        <span className="mt-1 block text-xs text-slate-500">{checkedIn ? 'Check-in saved' : 'Your input matters'}</span>
      </Link>
      <Link href="#progress" className="rounded-2xl bg-white/5 p-3 hover:bg-white/10">
        <span className="block text-xs text-slate-500">Training trend</span>
        <span className="mt-1 block text-sm font-semibold text-white">{progress ? `${progress.changePct > 0 ? '+' : ''}${progress.changePct}%` : 'Building history'}</span>
        <span className="mt-1 block text-xs text-slate-500">{progress ? `Load-based fitness · ${progress.windowWeeks} weeks` : 'No estimate yet'}</span>
      </Link>
      <Link href="#progress" className="rounded-2xl bg-white/5 p-3 hover:bg-white/10">
        <span className="block text-xs text-slate-500">Your goal</span>
        <span className="mt-1 block text-sm font-semibold text-white">{daysAway != null && daysAway >= 0 ? `${daysAway} days` : 'Your next chapter'}</span>
        <span className="mt-1 block break-words text-xs text-slate-500">{goalName ?? 'Choose what matters'}</span>
      </Link>
    </div>
    {adherence != null && <p className="mt-3 text-xs text-slate-500">{Math.round(adherence)}% planned-work adherence over tracked weeks. Recovery days belong in the plan.</p>}
    <nav aria-label="Daily view" className="mt-4 flex flex-wrap gap-2 text-sm font-semibold">
      <a href="#check-in" className="rounded-full bg-lime-300 px-4 py-2.5 text-[#10141f]">{checkedIn ? 'Update check-in' : 'How do you feel?'}</a>
      <a href="#today" className="rounded-full bg-white/10 px-4 py-2.5 text-white">Today’s workout</a>
      <a href="#progress" className="rounded-full bg-white/10 px-4 py-2.5 text-white">Goal progress</a>
    </nav>
  </section>;
}
