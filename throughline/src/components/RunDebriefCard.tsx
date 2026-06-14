/**
 * Post-run debrief: the coach's "what went well / focus next" read, with the
 * grounded signals it noticed (sleep, feel, breaks, terrain). Pure markup; data
 * from server/runDebrief.ts.
 */
import type { RunDebriefResult } from '@/server/runDebrief';

const CHIP: Record<string, string> = {
  positive: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/30',
  caution: 'bg-amber-400/10 text-amber-300 ring-amber-400/30',
  context: 'bg-slate-400/10 text-slate-300 ring-slate-400/30',
};
const SIGNAL_LABEL: Record<string, string> = {
  showed_up: 'Showed up',
  sleep: 'Sleep',
  feel: 'How you felt',
  stops: 'Breaks',
  terrain: 'Terrain',
  pace: 'Pace',
  distance: 'Distance',
};

export function RunDebriefCard({ debrief }: { debrief: RunDebriefResult }) {
  return (
    <div className="rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 p-6 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Coach&rsquo;s debrief</span>
        {debrief.narrated && <span className="text-[10px] text-slate-500">· in your coach&rsquo;s words</span>}
      </div>
      <h2 className="mt-1 text-xl font-extrabold tracking-tight text-white">{debrief.headline}</h2>

      {/* signal chips — the grounded facts the coach noticed */}
      {debrief.signals.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {debrief.signals.map((s, i) => (
            <span
              key={i}
              title={s.fact}
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${CHIP[s.polarity]}`}
            >
              {SIGNAL_LABEL[s.key] ?? s.key}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-3">
        <div className="rounded-2xl bg-emerald-400/10 p-4 ring-1 ring-inset ring-emerald-400/30">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">What went well</div>
          <p className="mt-1 text-sm leading-relaxed text-slate-200">{debrief.wentWell}</p>
        </div>
        <div className="rounded-2xl bg-amber-400/10 p-4 ring-1 ring-inset ring-amber-400/30">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">Focus next time</div>
          <p className="mt-1 text-sm leading-relaxed text-slate-200">{debrief.focusNext}</p>
        </div>
      </div>
    </div>
  );
}
