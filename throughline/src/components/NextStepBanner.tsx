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
  paceLabel: string | null; // "5:11/mi–5:24/mi"
  segments: PortalSegment[];
  description: string | null;
  terrain: string | null;
  adjustments: string[];
}

const TONE: Record<NextStep['tone'], string> = {
  action: 'from-indigo-600/30 via-[#10141f] to-[#0c0f17] ring-indigo-400/30',
  positive: 'from-emerald-600/25 via-[#10141f] to-[#0c0f17] ring-emerald-400/30',
  neutral: 'from-slate-600/20 via-[#10141f] to-[#0c0f17] ring-slate-400/20',
};

export function NextStepBanner({
  step,
  athleteId,
  easeDirectives,
  latestActivityId,
  session,
  loggedToday,
}: {
  step: NextStep;
  athleteId: string;
  easeDirectives: EaseDirective[];
  latestActivityId: string | null;
  /** The workout to show inline on a training day ('today' / 'eased_today'). */
  session?: TodaySessionDetail | null;
  /** Miles logged today, shown on the 'done_today' step. */
  loggedToday?: { miles: number; runCount: number } | null;
}) {
  return (
    <div className={`rounded-3xl bg-gradient-to-br p-5 shadow-lg ring-1 ring-inset ${TONE[step.tone]}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Your next step</div>
      <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold tracking-tight text-white">
        <span aria-hidden>{step.emoji}</span>
        <span>{step.headline}</span>
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{step.detail}</p>

      {loggedToday && (
        <p className="mt-1.5 text-sm font-semibold text-lime-200">
          {loggedToday.miles.toFixed(1)} mi logged today
          {loggedToday.runCount > 1 ? ` across ${loggedToday.runCount} runs` : ''}.
        </p>
      )}

      {/* The specific workout, inline — reps, paces, recoveries. */}
      {session && (session.segments.length > 0 || session.description) && (
        <div className="mt-3 rounded-2xl bg-white/5 p-3.5 ring-1 ring-inset ring-white/10">
          {session.paceLabel && (
            <div className="text-sm font-semibold tabular-nums text-white/85">{session.paceLabel}</div>
          )}
          {session.adjustments.length > 0 && (
            <div className="mt-1 inline-block rounded bg-amber-300/20 px-1.5 py-0.5 text-[11px] font-medium text-amber-200">
              {session.adjustments.join('; ')}
            </div>
          )}
          {session.segments.length > 0 ? (
            <SegmentList segments={session.segments} onDark />
          ) : (
            session.description && <p className="mt-1 text-sm leading-relaxed text-white/70">{session.description}</p>
          )}
          {session.terrain && <p className="mt-2 text-xs text-slate-400">📍 {session.terrain}</p>}
        </div>
      )}

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
            className="inline-block rounded-full bg-lime-300 px-4 py-2 text-sm font-semibold text-[#0c1018] transition hover:bg-lime-200"
          >
            {step.cta.label}
          </a>
        )}
        {step.cta.type === 'view_run' && latestActivityId && (
          <Link
            href={`/me/${athleteId}/runs/${latestActivityId}`}
            className="inline-block text-sm font-semibold text-sky-300 hover:underline"
          >
            {step.cta.label} →
          </Link>
        )}
      </div>
    </div>
  );
}
