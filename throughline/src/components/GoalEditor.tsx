/**
 * Discipline-aware goal editor — the "Your goal" card at the bottom of the portal.
 * Adjusting a goal has to match the sport it's FOR: a runner edits their run goal
 * inline, a cyclist jumps to the cycling setup, and a triathlete edits the whole
 * swim/bike/run plan (never a single leg, which would clobber the other two).
 * Which editor(s) show is decided by the live trackers, not assumed to be running.
 */
import Link from 'next/link';
import { Card } from '@/components/ui';
import { GoalSetup } from '@/components/GoalSetup';
import type { Units } from '@/lib/units';

const disciplineLink =
  'flex items-center justify-between gap-3 rounded-xl bg-slate-500/5 px-3.5 py-2.5 text-sm ring-1 ring-inset ring-slate-500/15 transition hover:bg-slate-500/10';

export function GoalEditor({
  athleteId,
  goalName,
  goalDate,
  hasAnchor,
  units,
  /** A genuine single-sport RUN goal (edited inline). */
  hasRunGoal,
  /** A cycling goal (edited on the bike-setup page). */
  hasBikeGoal,
  /** A triathlon — or a goal mislabeled as run-only that's really a tri. Edited
   *  as the whole swim/bike/run plan. */
  isTriathlon,
  /** Show the "add a target time" nudge (the run tracker has no on-pace verdict yet). */
  addTargetTimeHint,
}: {
  athleteId: string;
  goalName: string;
  goalDate: string;
  hasAnchor: boolean;
  units: Units;
  hasRunGoal: boolean;
  hasBikeGoal: boolean;
  isTriathlon: boolean;
  addTargetTimeHint: boolean;
}) {
  return (
    <Card title="Your goal">
      <p className="mb-3 text-xs text-slate-500">
        {goalName} · {goalDate}
        {addTargetTimeHint ? ', add a target time to unlock the on-pace verdict.' : ''}
      </p>

      {isTriathlon ? (
        // Edit the whole triathlon — editing one leg in isolation would rebuild a
        // single-sport plan and lose the other two.
        <div className="space-y-2">
          <Link href={`/me/${athleteId}/tri-setup`} className={disciplineLink}>
            <span className="font-medium text-slate-700">🏊 🚴 🏃 Edit your triathlon — swim, bike, and run in one plan</span>
            <span aria-hidden className="shrink-0 font-semibold text-lime-600">Edit →</span>
          </Link>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Update your race, target finish, fitness in each sport, or weekly hours. Training bike and run now?
            Set the swim aside and add it when you start.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {hasBikeGoal && (
            <Link href={`/me/${athleteId}/bike-setup`} className={disciplineLink}>
              <span className="font-medium text-slate-700">🚴 Edit your cycling goal</span>
              <span aria-hidden className="shrink-0 font-semibold text-orange-500">Edit →</span>
            </Link>
          )}

          {hasRunGoal && <GoalSetup athleteId={athleteId} hasAnchor={hasAnchor} hasGoal units={units} />}

          {/* Cross-discipline discovery: adjusting a goal is also where you add
              another sport or fold everything into a triathlon. */}
          <div className="mt-1 space-y-1.5 border-t border-slate-500/10 pt-3 text-xs text-slate-500">
            {!hasBikeGoal && (
              <Link href={`/me/${athleteId}/bike-setup`} className="block font-semibold text-slate-600 hover:underline">
                Add a cycling goal →
              </Link>
            )}
            <Link href={`/me/${athleteId}/tri-setup`} className="block font-semibold text-slate-600 hover:underline">
              Training for a triathlon? Set up swim, bike, and run →
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}
