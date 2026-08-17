'use client';

import { useState } from 'react';

/**
 * Athlete-driven injury flow. No active injury → a quiet "Something hurts?"
 * that opens a short report form. Active injury → the status + the resume check
 * ("ready to test an easy run?"). We never suggest treatment/physio — we pause,
 * ask how it's feeling, and ramp back when they say they're ready.
 */
export interface InjuryState {
  id: string;
  bodyPart: string;
  status: 'acute' | 'returning';
  canContinue: boolean | null;
  checkBackDate: string | null;
  checkDue: boolean;
}

const BODY_PARTS = ['Knee', 'Achilles', 'Calf', 'Hamstring', 'Foot', 'Shin', 'Hip', 'Back', 'Other'];
const CHECK_BACKS = [
  { label: 'in 3 days', days: 3 },
  { label: 'in a week', days: 7 },
  { label: 'in 2 weeks', days: 14 },
];

async function post(athleteId: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`/api/athletes/${athleteId}/injury`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json())?.ok === true;
  } catch {
    return false;
  }
}

function fmtDay(day: string): string {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [, m, d] = day.split('-').map(Number);
  return `${M[m - 1]} ${d}`;
}

export function InjuryPanel({ athleteId, injury }: { athleteId: string; injury: InjuryState | null }) {
  const [pending, setPending] = useState(false);
  const done = () => setTimeout(() => window.location.reload(), 500);
  const act = async (body: Record<string, unknown>) => {
    setPending(true);
    if (await post(athleteId, body)) done();
    else setPending(false);
  };

  if (injury) return <ActiveInjury injury={injury} pending={pending} act={act} />;
  return <ReportEntry pending={pending} act={act} />;
}

function ActiveInjury({
  injury,
  pending,
  act,
}: {
  injury: InjuryState;
  pending: boolean;
  act: (body: Record<string, unknown>) => void;
}) {
  const part = injury.bodyPart.toLowerCase();
  const paused = injury.status === 'acute' && injury.canContinue === false;

  return (
    <div className="rounded-3xl bg-amber-400/10 p-5 shadow-lg ring-1 ring-inset ring-amber-400/25">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-amber-300/90">
        <span aria-hidden>🩹</span>
        {injury.status === 'returning' ? 'Easing back' : paused ? 'Running paused' : 'Training eased'}
      </div>

      {injury.status === 'returning' ? (
        <>
          <p className="mt-1.5 text-sm leading-relaxed text-white/90">
            Easing back after your {part}, start soft and let it build. Nothing hard until it feels 100%.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => act({ action: 'clear', injuryId: injury.id })}
            className="mt-3 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white ring-1 ring-inset ring-white/15 hover:bg-white/15 disabled:opacity-50"
          >
            Fully recovered, clear it
          </button>
        </>
      ) : paused ? (
        <>
          <p className="mt-1.5 text-sm leading-relaxed text-white/90">
            We&apos;ve paused your running to rest the {part}.{' '}
            {injury.checkBackDate && !injury.checkDue ? `We'll check back around ${fmtDay(injury.checkBackDate)}.` : ''}
          </p>
          <p className="mt-2 text-sm font-semibold text-white">
            {injury.checkDue ? `How's the ${part}? Ready to test an easy run?` : 'Feeling ready sooner?'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => act({ action: 'resume', injuryId: injury.id })}
              className="rounded-full bg-lime-300 px-3.5 py-1.5 text-xs font-semibold text-[#0c1018] hover:bg-lime-200 disabled:opacity-50"
            >
              Ready, ease me back in
            </button>
            {CHECK_BACKS.map((c) => (
              <button
                key={c.days}
                type="button"
                disabled={pending}
                onClick={() => act({ action: 'still_hurt', injuryId: injury.id, checkBackDays: c.days })}
                className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white/80 ring-1 ring-inset ring-white/15 hover:bg-white/15 disabled:opacity-50"
              >
                Still sore, check {c.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-sm leading-relaxed text-white/90">
            Keeping things easier while your {part} settles. Back off further any time it flares.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => act({ action: 'clear', injuryId: injury.id })}
              className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white ring-1 ring-inset ring-white/15 hover:bg-white/15 disabled:opacity-50"
            >
              It&apos;s better, clear it
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => act({ action: 'report', bodyPart: injury.bodyPart, canContinue: false, checkBackDays: 7 })}
              className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-medium text-white/80 ring-1 ring-inset ring-white/15 hover:bg-white/15 disabled:opacity-50"
            >
              Getting worse, pause running
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ReportEntry({ pending, act }: { pending: boolean; act: (body: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const [bodyPart, setBodyPart] = useState('');
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState('');
  const part = bodyPart === 'Other' ? custom.trim() : bodyPart;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="px-1 text-sm font-medium text-amber-300 hover:underline">
        Something hurts? Report it →
      </button>
    );
  }

  return (
    <div className="rounded-3xl bg-amber-400/10 p-5 shadow-lg ring-1 ring-inset ring-amber-400/25">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-300/90">Report an injury</div>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:text-slate-200">
          Cancel
        </button>
      </div>

      <div className="mt-3 text-sm text-white/90">What hurts?</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {BODY_PARTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setBodyPart(p)}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
              bodyPart === p ? 'bg-amber-300 text-[#0c1018] ring-amber-300' : 'bg-white/5 text-white/80 ring-white/15 hover:bg-white/10'
            }`}
          >
            {p}
          </button>
        ))}
      </div>
      {bodyPart === 'Other' && (
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="e.g. left ankle"
          className="mt-2 w-full rounded-lg bg-white/5 px-3 py-1.5 text-sm text-white ring-1 ring-inset ring-white/15 placeholder:text-slate-500"
        />
      )}

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything to note? (optional)"
        className="mt-2 w-full rounded-lg bg-white/5 px-3 py-1.5 text-sm text-white ring-1 ring-inset ring-white/15 placeholder:text-slate-500"
      />

      <div className="mt-3 text-sm text-white/90">Can you keep training through it?</div>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={pending || !part}
          onClick={() => act({ action: 'report', bodyPart: part, canContinue: true, note })}
          className="flex-1 rounded-xl bg-white/10 px-3 py-2.5 text-sm font-semibold text-white ring-1 ring-inset ring-white/15 hover:bg-white/15 disabled:opacity-40"
        >
          Yes, keep going, just easier
        </button>
        <button
          type="button"
          disabled={pending || !part}
          onClick={() => act({ action: 'report', bodyPart: part, canContinue: false, note, checkBackDays: 7 })}
          className="flex-1 rounded-xl bg-amber-300 px-3 py-2.5 text-sm font-semibold text-[#0c1018] hover:bg-amber-200 disabled:opacity-40"
        >
          No, pause my running
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
        We&apos;ll pause your running and check back in a week, you can change that any time. We won&apos;t
        give medical or treatment advice; for that, see a professional.
      </p>
    </div>
  );
}
