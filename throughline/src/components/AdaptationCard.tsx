/**
 * Missed-day adaptation card — encouragement first, with a one-tap ease-back
 * after a real layoff. Once the ease-back is applied it flips to a CONFIRMATION
 * that names today's (eased) workout, so the athlete on the automatic plan is
 * guided to the next step instead of seeing the same prompt again. Pure markup.
 */
import type { AdaptationState } from '@/server/adaptation';
import { easeBackDirectives } from '@/server/adaptation';
import { EaseBackButton } from '@/components/EaseBackButton';

const TONE_STYLE: Record<string, string> = {
  on_track: 'border-lime-400/30 bg-lime-400/[0.06]',
  slipped: 'border-sky-400/30 bg-sky-400/[0.06]',
  returning: 'border-amber-400/30 bg-amber-400/[0.06]',
};

export interface AdaptationToday {
  sessionType: string;
  distanceMeters: number | null;
  adjustments: string[];
}

const MI = 1609.344;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function nextStepLine(t: AdaptationToday | null | undefined): string {
  if (!t || t.sessionType === 'rest' || (t.distanceMeters ?? 0) <= 0) {
    return 'Today is a rest day — take it; you’re back at it tomorrow.';
  }
  const miles = ((t.distanceMeters ?? 0) / MI).toFixed(1);
  const eased = t.adjustments.some((a) => /eased|shortened|reduced|easier/i.test(a)) ? ' — already eased for you' : '';
  return `Today: ${cap(t.sessionType)} ${miles} mi${eased}. Start there — momentum first.`;
}

export function AdaptationCard({
  state,
  athleteId,
  today,
  todaySession,
}: {
  state: AdaptationState;
  athleteId: string;
  today: string;
  todaySession?: AdaptationToday | null;
}) {
  const directives = easeBackDirectives(state, today);

  // Applied → a clear confirmation + the concrete next step (no re-prompt).
  if (state.easeBackApplied) {
    return (
      <div className="rounded-2xl border border-lime-400/30 bg-lime-400/[0.06] p-4">
        <h2 className="text-base font-bold tracking-tight text-slate-900">✓ You’re eased back in</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Your next few days are trimmed so the return feels good — we’re not cramming the missed miles.{' '}
          {nextStepLine(todaySession)}
        </p>
        <p className="mt-2 text-xs text-slate-500">It ramps back to full on its own. Your coach can change it anytime.</p>
      </div>
    );
  }

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
