/**
 * Body status: what the athlete's recovery signals say right now, the readings
 * behind it, what the plan did about it, and the question we need answered.
 * `compact` is the one-line version for the Today tab when all is well.
 */
import type { BodyStatusView } from '@/server/bodyStatus';
import { BodyStatusActions } from '@/components/BodyStatusActions';

const SURFACE: Record<BodyStatusView['tone'], string> = {
  good: 'surface-hero-positive',
  neutral: 'bg-card ring-1 ring-inset ring-white/[0.06]',
  caution: 'surface-hero-caution',
  alert: 'surface-hero-alert',
};
const DOT: Record<BodyStatusView['tone'], string> = { good: 'bg-emerald-400', neutral: 'bg-slate-400', caution: 'bg-amber-400', alert: 'bg-rose-400' };
const LABEL: Record<BodyStatusView['status'], string> = {
  unknown: 'No recent data',
  ready: 'In your normal range',
  primed: 'Absorbing well',
  watch: 'Watching',
  strained: 'Strained',
  under_recovered: 'Short on recovery',
  overreaching: 'Fatigue building',
  illness_suspected: 'Possible illness',
  ill: 'Ill',
  returning: 'Easing back in',
};

export function BodyStatusCard({
  view,
  athleteId,
  compact = false,
  restToday = false,
}: {
  view: BodyStatusView;
  athleteId: string;
  compact?: boolean;
  /** Today's plan is a rest day, so "do today's session…" steps don't apply. */
  restToday?: boolean;
}) {
  const steps =
    restToday && view.today.length > 0 && view.status !== 'watch' && view.status !== 'ill'
      ? ['No session is planned today. Rest, or take an easy 20 to 30 minute walk.']
      : view.today;
  // All clear on the Today tab: one quiet line, so the athlete knows we're watching.
  if (compact && (view.status === 'ready' || (view.status === 'unknown' && !view.dataDay))) {
    if (view.status === 'unknown') return null;
    return (
      <a
        href={`/me/${athleteId}?tab=body`}
        className="flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 text-sm ring-1 ring-inset ring-white/[0.06] transition hover:bg-white/[0.04]"
      >
        <span className="flex min-w-0 items-center gap-2.5 text-slate-600">
          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT.good}`} aria-hidden />
          Body: your recovery signals are in your normal range
        </span>
        <span aria-hidden className="shrink-0 font-semibold text-lime-300">Details →</span>
      </a>
    );
  }

  return (
    <section className={`rounded-3xl p-6 ${SURFACE[view.tone]}`} aria-label="Body status">
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <span className={`h-2 w-2 rounded-full ${DOT[view.tone]}`} aria-hidden />
        Body status · {LABEL[view.status]}
        {view.episode && view.status !== 'returning' && <span className="text-slate-500">· day {view.episode.days}</span>}
      </div>
      <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-white">{view.headline}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{view.body}</p>

      {view.markers.length > 0 && (
        <ul className="mt-4 space-y-2 rounded-2xl bg-black/25 p-4 text-sm" aria-label="Where each signal stands">
          {view.markers.map((m) => (
            <li key={m.key} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  m.state === 'back' ? 'bg-emerald-400/20 text-emerald-300' : m.state === 'improving' ? 'bg-amber-400/20 text-amber-300' : 'bg-rose-400/20 text-rose-300'
                }`}
              >
                {m.state === 'back' ? '✓' : m.state === 'improving' ? '↗' : '!'}
              </span>
              <span className="text-slate-700">
                <span className="font-semibold text-white">{m.label}:</span> {m.text}
              </span>
            </li>
          ))}
        </ul>
      )}

      {view.evidence.length > 0 && view.markers.length === 0 && (
        <ul className="mt-4 space-y-1.5 rounded-2xl bg-black/25 p-4 text-sm text-slate-700">
          {view.evidence.slice(0, compact ? 3 : 6).map((e) => (
            <li key={e} className="flex gap-2">
              <span aria-hidden className="text-slate-500">•</span>
              <span>{e}</span>
            </li>
          ))}
          {view.load.note && view.load.ratio != null && (view.load.ratio >= 1.3 || view.load.ratio <= 0.6) && (
            <li className="flex gap-2">
              <span aria-hidden className="text-slate-500">•</span>
              <span>{view.load.note}</span>
            </li>
          )}
        </ul>
      )}

      {steps.length > 0 && (
        <div className="mt-4 rounded-2xl bg-white/[0.06] p-4">
          <h3 className="text-sm font-semibold text-white">Do this today</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
            {steps.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
          {view.next && (
            <p className="mt-3 border-t border-white/10 pt-3 text-sm leading-relaxed text-slate-600">
              <span className="font-semibold text-white">Next: </span>
              {view.next}
            </p>
          )}
        </div>
      )}

      {view.planNote && (
        <p className="mt-4 text-sm leading-relaxed text-white">
          <span className="font-semibold">What changed in your plan: </span>
          {view.planNote}
        </p>
      )}
      {view.advice.map((a) => (
        <p key={a} className="mt-2 text-sm leading-relaxed text-slate-500">{a}</p>
      ))}

      {view.asks.length > 0 && (
        <div className="mt-5">
          <BodyStatusActions
            athleteId={athleteId}
            question={view.question}
            asks={view.asks}
            // With no question pending, illness reporting stays a quiet link.
            quiet={!view.question && view.asks.every((a) => a.action === 'sick_mild')}
          />
        </div>
      )}
      {compact && (
        <a href={`/me/${athleteId}?tab=body`} className="mt-4 inline-block text-sm font-semibold text-lime-300">
          See your signals →
        </a>
      )}
      <p className="mt-4 text-xs text-slate-500">Training guidance from your own data, not a medical diagnosis.</p>
    </section>
  );
}
