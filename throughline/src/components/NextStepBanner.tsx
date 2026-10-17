/**
 * The single "do this next" card for the athlete — now also the ONLY "today"
 * surface (the separate hero was merged in here to kill duplication). It answers
 * one question — what now? — for every lifecycle state (set fitness → pick goal
 * → ease back → today's run → rest → done → race over), and on a training day it
 * renders the SPECIFIC workout (segments + paces), not just the session label.
 * Server markup + one client child (EaseBackButton) for the action.
 */
import Link from 'next/link';
import type { NextStep } from '@/server/nextStepLogic';
import type { PortalSegment } from '@/server/portal';
import { EaseBackButton } from '@/components/EaseBackButton';
import { SegmentList } from '@/components/SegmentList';
import type { Units } from '@/lib/units';

interface EaseDirective {
  type: 'reduce_volume' | 'pace_adjust';
  from: string;
  to: string;
  factor?: number;
  deltaSecPerMile?: number;
  label: string;
}

/** The specific workout for a training day (shown inline on 'today' steps). */
export interface TodaySessionDetail {
  paceLabel: string | null; // "5:11/mi-5:24/mi"
  segments: PortalSegment[];
  description: string | null;
  terrain: string | null;
  adjustments: string[];
}

const SPORT_EMOJI: Record<string, string> = {
  run: '🏃',
  bike: '🚴',
  swim: '🏊',
  strength: '💪',
  cross_train: '🔁',
  other: '🤸',
};

const TONE: Record<NextStep['tone'], string> = {
  action: 'surface-hero',
  positive: 'surface-hero-positive',
  neutral: 'surface-hero',
};

/** Short label above the headline, so the headline itself can be just the session. */
const EYEBROW: Partial<Record<NextStep['kind'], string>> = {
  today: 'Today',
  eased_today: 'Today, eased',
  done_today: 'Done for today',
  rest_today: 'Today',
  ease_back: 'Welcome back',
  setup_fitness: 'Next step',
  set_goal: 'Next step',
  goal_done: 'Goal complete',
};

export function NextStepBanner({
  step,
  athleteId,
  easeDirectives,
  latestActivityId,
  session,
  loggedToday,
  units = 'mi',
}: {
  step: NextStep;
  athleteId: string;
  easeDirectives: EaseDirective[];
  latestActivityId: string | null;
  /** The workout to show inline on a training day ('today' / 'eased_today'). */
  session?: TodaySessionDetail | null;
  /** Everything logged today, per sport — shown on the 'done_today' step. */
  loggedToday?: { items: { sport: string; label: string }[] } | null;
  units?: Units;
}) {
  return (
    <div className={`rounded-3xl p-6 ${TONE[step.tone]}`}>
      <div className="flex items-start gap-4">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] text-xl">
          {step.emoji}
        </span>
        <div className="min-w-0">
          <div className="text-sm text-slate-400">{EYEBROW[step.kind] ?? 'Next step'}</div>
          {/* "Today: Easy 5 mi" → the eyebrow already says Today. */}
          <h2 className="mt-0.5 text-[1.75rem] font-semibold leading-tight tracking-tight text-white sm:text-3xl">
            {step.headline.replace(/^Today:\s*/, '')}
          </h2>
        </div>
      </div>
      <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{step.detail}</p>

      {loggedToday && loggedToday.items.length > 0 && (
        <p className="mt-1.5 text-sm font-semibold text-lime-200">
          Logged today:{' '}
          {loggedToday.items.map((it, i) => (
            <span key={it.sport}>
              {i > 0 ? ' · ' : ''}
              {SPORT_EMOJI[it.sport] ?? '🏅'} {it.label}
            </span>
          ))}
        </p>
      )}

      {/* The specific workout, inline: reps, paces, recoveries. The headline and
          detail already carry the volume and target, so the box only appears
          when it adds something (structure, an adjustment, a real note). */}
      {session && (() => {
        const note = session.description && !restatesTarget(session.description, session.paceLabel) ? session.description : null;
        const hasBox = session.segments.length > 0 || session.adjustments.length > 0 || !!note;
        if (!hasBox) {
          return session.terrain ? <p className="mt-2 text-xs text-slate-400">📍 {session.terrain}</p> : null;
        }
        return (
          <div className="mt-4 rounded-2xl bg-black/25 p-4">
            {session.adjustments.length > 0 && (
              <div className="inline-block rounded bg-amber-300/20 px-1.5 py-0.5 text-[11px] font-medium text-amber-200">
                {session.adjustments.join('; ')}
              </div>
            )}
            {session.segments.length > 0 ? (
              <SegmentList segments={session.segments} onDark units={units} />
            ) : (
              note && <p className="mt-1 text-sm leading-relaxed text-white/85">{note}</p>
            )}
            {session.terrain && <p className="mt-2 text-xs text-slate-400">📍 {session.terrain}</p>}
          </div>
        );
      })()}

      {step.readinessNote && (
        <div
          className={`mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-xs leading-relaxed ring-1 ring-inset ${
            step.readinessNote.tone === 'caution'
              ? 'bg-amber-400/10 text-amber-200 ring-amber-400/25'
              : 'bg-emerald-400/10 text-emerald-200 ring-emerald-400/25'
          }`}
        >
          <span aria-hidden>{step.readinessNote.tone === 'caution' ? '⚠️' : '⚡'}</span>
          <span>{step.readinessNote.text}</span>
        </div>
      )}

      <div className="mt-3">
        {step.cta.type === 'ease_back' && easeDirectives.length > 0 && (
          <EaseBackButton athleteId={athleteId} directives={easeDirectives} />
        )}
        {step.cta.type === 'scroll' && (
          <a
            href={step.cta.href}
            className="inline-flex h-11 items-center rounded-full bg-lime-300 px-5 text-sm font-semibold text-[#0a0a0b] transition hover:bg-lime-200"
          >
            {step.cta.label}
          </a>
        )}
        {step.cta.type === 'view_run' && latestActivityId && (
          <Link
            href={`/me/${athleteId}/runs/${latestActivityId}`}
            className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.12]"
          >
            {step.cta.label} →
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * A plan-generated description like "Easy run, 2.5 mi @ 9:23–10:47/mi" just
 * restates the headline and target. True when it repeats a pace or watt figure
 * from the target label, so the banner doesn't say the same pace three times.
 */
function restatesTarget(description: string, target: string | null): boolean {
  if (!target) return false;
  const tokens = target.match(/\d+:\d\d|\d+(?=-\d+ W)/g) ?? [];
  return tokens.some((t) => description.includes(t));
}
