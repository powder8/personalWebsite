/**
 * The single "do this next" guide for the automatic-coach athlete. Always
 * present at the top of the portal; it answers one question — what now? — for
 * every lifecycle state (set fitness → pick goal → ease back → today's run →
 * rest → done → race over). The ease-back action lives here too, so tapping it
 * announces itself right where the athlete is looking. Server markup + one
 * client child (EaseBackButton) for the action.
 */
import Link from 'next/link';
import type { NextStep } from '@/server/nextStepLogic';
import { EaseBackButton } from '@/components/EaseBackButton';

interface EaseDirective {
  type: 'reduce_volume' | 'pace_adjust';
  from: string;
  to: string;
  factor?: number;
  deltaSecPerMile?: number;
  label: string;
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
}: {
  step: NextStep;
  athleteId: string;
  easeDirectives: EaseDirective[];
  latestActivityId: string | null;
}) {
  return (
    <div className={`rounded-3xl bg-gradient-to-br p-5 shadow-lg ring-1 ring-inset ${TONE[step.tone]}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Your next step</div>
      <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold tracking-tight text-white">
        <span aria-hidden>{step.emoji}</span>
        <span>{step.headline}</span>
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{step.detail}</p>

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
