'use client';

import { useState } from 'react';
import type { CycleSettings, CycleStatus } from '@/server/cycleMath';

const PHASE_LABEL: Record<string, string> = {
  menstrual: 'Menstrual',
  follicular: 'Follicular',
  luteal: 'Luteal',
};

/**
 * Opt-in menstrual cycle tracking (athlete-facing). Mirrors the Apple Health
 * pattern: enter last period start + average cycle/period length, and we project
 * upcoming cycles and the current phase. Late-luteal days get a planning flag —
 * many women report fatigue then and prefer to avoid key racing.
 */
export function CycleTracking({
  athleteId,
  initial,
  status,
}: {
  athleteId: string;
  initial: CycleSettings;
  status: CycleStatus;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(next: CycleSettings) {
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/cycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      const json = await res.json();
      if (json.ok) {
        setTimeout(() => window.location.reload(), 600);
      } else {
        setErr(json.error ?? 'Failed.');
        setPending(false);
      }
    } catch {
      setErr('Network error.');
      setPending(false);
    }
  }

  async function onToggle(on: boolean) {
    setEnabled(on);
    // Persist the opt-in/out immediately; keep existing values either way.
    await save({ ...initial, enabled: on });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await save({
      enabled: true,
      lastStartDate: String(fd.get('lastStartDate') || '') || null,
      avgCycleDays: Number(fd.get('avgCycleDays')) || 28,
      avgPeriodDays: Number(fd.get('avgPeriodDays')) || 5,
    });
  }

  const field = 'mt-0.5 rounded border border-slate-300 px-2 py-1.5 text-sm';

  if (!enabled) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">
          Optional and private to you. Track your cycle to plan training and racing around it —
          many athletes feel more fatigued in the late luteal phase and prefer to avoid key efforts then.
        </p>
        <button
          onClick={() => onToggle(true)}
          disabled={pending}
          className="rounded bg-rose-700 px-4 py-2 text-sm font-medium text-white hover:bg-rose-800 disabled:opacity-50"
        >
          {pending ? 'Enabling…' : 'Turn on cycle tracking'}
        </button>
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Current status / projection */}
      {status.enabled && status.phase && status.dayInCycle != null ? (
        <div className={`rounded-lg p-3 ${status.lateLuteal ? 'bg-amber-50' : 'bg-rose-50/60'}`}>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-semibold text-slate-800">{PHASE_LABEL[status.phase]} phase</span>
              <span className="ml-2 text-xs text-slate-500">day {status.dayInCycle}</span>
            </div>
            {status.daysUntilNext != null && (
              <span className="text-xs text-slate-500">
                next in {status.daysUntilNext} {status.daysUntilNext === 1 ? 'day' : 'days'}
              </span>
            )}
          </div>
          {status.lateLuteal && (
            <p className="mt-2 text-xs font-medium text-amber-800">
              ⚠ Late luteal — fatigue is more common now. Worth easing key sessions and avoiding A-races in this window.
            </p>
          )}
          {status.upcoming.length > 0 && (
            <div className="mt-2 border-t border-rose-100 pt-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Projected next cycles</div>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {status.upcoming.map((c) => (
                  <li key={c.start}>
                    {c.start} → {c.periodEnd}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-500">Enter your last period start below to see projections.</p>
      )}

      {/* Settings */}
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="text-xs text-slate-600">
            First day of last cycle
            <input
              name="lastStartDate"
              type="date"
              defaultValue={initial.lastStartDate ?? ''}
              className={`block w-full ${field}`}
            />
          </label>
          <label className="text-xs text-slate-600">
            Avg cycle length (days)
            <input
              name="avgCycleDays"
              type="number"
              min={15}
              max={60}
              defaultValue={initial.avgCycleDays}
              className={`block w-full ${field}`}
            />
          </label>
          <label className="text-xs text-slate-600">
            Avg period length (days)
            <input
              name="avgPeriodDays"
              type="number"
              min={1}
              max={14}
              defaultValue={initial.avgPeriodDays}
              className={`block w-full ${field}`}
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-rose-700 px-4 py-2 text-sm font-medium text-white hover:bg-rose-800 disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => onToggle(false)}
            disabled={pending}
            className="text-xs text-slate-500 hover:text-slate-700 hover:underline disabled:opacity-50"
          >
            Turn off &amp; hide
          </button>
        </div>
        {err && <p className="text-sm text-rose-600">{err}</p>}
        <p className="text-[11px] text-slate-400">
          Private to you. Your coach sees only your current phase for planning — no dates.
        </p>
      </form>
    </div>
  );
}
