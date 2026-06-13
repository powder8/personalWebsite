/**
 * Missed-day adaptation card — encouragement first, with a one-tap ease-back
 * after a real layoff. Tone is set by adaptationLogic; this is the surface that
 * keeps an athlete from quitting after a slip. Pure server markup.
 */
import type { AdaptationState } from '@/server/adaptation';
import { easeBackDirectives } from '@/server/adaptation';
import { EaseBackButton } from '@/components/EaseBackButton';

const TONE_STYLE: Record<string, string> = {
  on_track: 'border-lime-400/30 bg-lime-400/[0.06]',
  slipped: 'border-sky-400/30 bg-sky-400/[0.06]',
  returning: 'border-amber-400/30 bg-amber-400/[0.06]',
};

export function AdaptationCard({
  state,
  athleteId,
  today,
}: {
  state: AdaptationState;
  athleteId: string;
  today: string;
}) {
  const directives = easeBackDirectives(state, today);
  return (
    <div className={`rounded-2xl border p-4 ${TONE_STYLE[state.tone] ?? TONE_STYLE.slipped}`}>
      <h2 className="text-base font-bold tracking-tight text-slate-900">{state.headline}</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{state.body}</p>
      {directives.length > 0 && (
        <div className="mt-3">
          <EaseBackButton athleteId={athleteId} directives={directives} />
        </div>
      )}
      {state.easeBack?.rebuildSuggested && (
        <p className="mt-2 text-xs text-slate-500">
          Tip: ask your coach below, or use “Change your goal” to rebuild the plan from where you are now.
        </p>
      )}
    </div>
  );
}
