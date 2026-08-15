/**
 * "Your sports" — the discoverable, always-present path from single-sport to
 * triathlete. Deliberately QUIET: a runner who only wants to run sees their run
 * fitness and an unobtrusive way to add cycling/swimming, never a nag. A
 * multi-sport athlete sees all three at a glance. Data from server/disciplines.
 */
import Link from 'next/link';
import { Card } from '@/components/ui';
import type { AthleteDisciplines } from '@/server/disciplines';

const EMOJI = { run: '🏃', bike: '🚴', swim: '🏊' } as const;
const NAME = { run: 'Run', bike: 'Bike', swim: 'Swim' } as const;

export function YourSports({
  athleteId,
  disciplines,
  hasTriGoal,
}: {
  athleteId: string;
  disciplines: AthleteDisciplines;
  /** True when a multi-sport (triathlon) goal is already active. */
  hasTriGoal?: boolean;
}) {
  const { statuses, count } = disciplines;
  const missing = statuses.filter((s) => !s.anchorSet).map((s) => NAME[s.discipline].toLowerCase());
  const complete = count === 3;

  return (
    <Card title="Your sports">
      <ul className="space-y-1.5">
        {statuses.map((s) => (
          <li key={s.discipline} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <span aria-hidden className={s.anchorSet ? '' : 'opacity-40'}>{EMOJI[s.discipline]}</span>
              <span className={s.anchorSet ? 'font-medium text-slate-700' : 'text-slate-400'}>{NAME[s.discipline]}</span>
            </span>
            {s.anchorSet ? (
              <span className="tabular-nums text-xs text-slate-500">{s.anchorLabel}</span>
            ) : (
              <Link href={`/me/${athleteId}/tri-setup`} className="text-xs font-semibold text-lime-600 hover:underline">
                Add →
              </Link>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
        {complete ? (
          <Link href={`/me/${athleteId}/tri-setup`} className="font-semibold text-slate-600 hover:underline">
            Update your triathlon plan →
          </Link>
        ) : (
          <>
            Training for more than one sport?{' '}
            <Link href={`/me/${athleteId}/tri-setup`} className="font-semibold text-lime-600 hover:underline">
              {hasTriGoal ? 'Finish your triathlon setup' : `Add ${missing.join(' & ')} to build toward a triathlon`} →
            </Link>
          </>
        )}
      </div>
    </Card>
  );
}
