'use client';

import { useEffect, useState } from 'react';

type GoalKind = 'finish' | 'time' | 'fitness';
const DISTANCES = [
  { label: '5K', value: '5K' },
  { label: '10K', value: '10K' },
  { label: 'Half Marathon', value: 'Half' },
  { label: 'Marathon', value: 'Marathon' },
];

/**
 * Forgiving race-time parser → seconds. Accepts:
 *   "22"        → 22:00  (bare number = minutes)
 *   "22:30"     → 22m30s
 *   "1:45:00"   → 1h45m
 *   "1.45.00" / "1 45 00" → same (./space treated like :)
 * Returns null only if it's blank or truly unparseable.
 */
function parseClock(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const parts = t.split(/[:.\s]+/).map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 1) return parts[0] * 60; // bare minutes
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/**
 * Athlete-facing goal setup. Three paths — finish a distance, race for time, or
 * build fitness — plus a light read of current fitness + weekly mileage, which
 * generates a real plan. Collapsed behind a button when a goal already exists.
 */
export function GoalSetup({
  athleteId,
  hasAnchor,
  hasGoal,
  startOpen,
  redirectTo,
  submitLabel,
  recentRaces,
}: {
  athleteId: string;
  hasAnchor: boolean;
  hasGoal: boolean;
  /** Force the form open initially (e.g. post-race "what's next?" prompt). */
  startOpen?: boolean;
  /** Where to go after success (onboarding → portal). Defaults to a reload. */
  redirectTo?: string;
  /** Override the submit button text (e.g. "Build my plan"). */
  submitLabel?: string;
  /** The athlete's actual recent races (from synced runs) — pick instead of recall. */
  recentRaces?: { distanceLabel: string; timeLabel: string; distanceMeters: number; durationSeconds: number; day: string; paceLabel: string }[];
}) {
  const [open, setOpen] = useState(startOpen ?? !hasGoal);
  const [kind, setKind] = useState<GoalKind>('finish');
  const [fitnessKind, setFitnessKind] = useState<'existing' | 'race'>(hasAnchor ? 'existing' : 'race');
  // Controlled so the recent-race picker can prefill them.
  const [fitDistance, setFitDistance] = useState('5K');
  const [fitTime, setFitTime] = useState('');
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Open the editor when the page is navigated to its anchor (e.g. the goal
  // tracker's "Adjust your goal" CTA → #goal-setup), including clicks while this
  // component is already mounted. Without this, the CTA scrolls to a collapsed
  // card and appears to do nothing.
  useEffect(() => {
    const openIfTargeted = () => {
      if (typeof window !== 'undefined' && window.location.hash === '#goal-setup') setOpen(true);
    };
    openIfTargeted();
    window.addEventListener('hashchange', openIfTargeted);
    return () => window.removeEventListener('hashchange', openIfTargeted);
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const fd = new FormData(e.currentTarget);

    const body: Record<string, unknown> = {
      kind,
      currentWeeklyMiles: Number(fd.get('currentWeeklyMiles') || 0),
    };
    if (kind !== 'fitness') {
      body.distanceLabel = String(fd.get('distanceLabel') || '');
      body.date = String(fd.get('date') || '');
      if (kind === 'time') {
        const secs = parseClock(String(fd.get('targetTime') || ''));
        if (!secs) {
          setErr('Enter a target time like 1:45:00.');
          return;
        }
        body.targetTimeSeconds = secs;
      }
    }
    if (fitnessKind === 'race') {
      const secs = parseClock(fitTime);
      if (!secs) {
        setErr('Add a recent race time, pick one of your runs above, or type it like 22:30 (or just 22 for 22 min).');
        return;
      }
      const picked = pickedDay ? recentRaces?.find((r) => r.day === pickedDay) : undefined;
      body.fitness = { kind: 'race', distanceLabel: fitDistance, timeSeconds: secs, distanceMeters: picked?.distanceMeters };
    } else {
      body.fitness = { kind: 'existing' };
    }

    setPending(true);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/goal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (j.ok) {
        setTimeout(() => {
          if (redirectTo) window.location.assign(redirectTo);
          else window.location.reload();
        }, 700);
      } else {
        setErr(j.error ?? 'Failed.');
        setPending(false);
      }
    } catch {
      setErr('Network error.');
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm font-medium text-violet-300 hover:underline">
        Change goal
      </button>
    );
  }

  const field = 'mt-0.5 rounded border border-slate-300 px-2 py-1.5 text-sm';
  const seg = (active: boolean) =>
    `flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
      active ? 'border-violet-400/30 bg-violet-400/10 text-violet-200' : 'border-slate-200 bg-card text-slate-600 hover:bg-slate-50'
    }`;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Name the sport up front — this editor sets your RUNNING goal (a separate
          card sets cycling). Without it, a multisport athlete can't tell which
          sport the "miles" fields belong to. */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-300 ring-1 ring-inset ring-sky-400/30">
          🏃 Running goal
        </span>
      </div>

      {/* Goal kind */}
      <div>
        <div className="text-xs text-slate-600">What’s your running goal?</div>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <button type="button" className={seg(kind === 'finish')} onClick={() => setKind('finish')}>
            Finish a distance
          </button>
          <button type="button" className={seg(kind === 'time')} onClick={() => setKind('time')}>
            Race for a time
          </button>
          <button type="button" className={seg(kind === 'fitness')} onClick={() => setKind('fitness')}>
            Build fitness
          </button>
        </div>
      </div>

      {/* Race details (finish / time) */}
      {kind !== 'fitness' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="text-xs text-slate-600">
            Distance
            <select name="distanceLabel" defaultValue="5K" className={`block w-full ${field}`}>
              {DISTANCES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Race date
            <input name="date" type="date" required className={`block w-full ${field}`} />
          </label>
          {kind === 'time' && (
            <label className="text-xs text-slate-600">
              Target time (h:mm:ss)
              <input name="targetTime" placeholder="1:45:00" className={`block w-full ${field}`} />
            </label>
          )}
        </div>
      )}
      {kind === 'fitness' && (
        <p className="text-xs text-slate-500">
          No race in mind, we’ll build a progressive ~12-week block to grow your aerobic base and consistency.
        </p>
      )}

      {/* Current fitness */}
      <div>
        <div className="text-xs text-slate-600">Where’s your fitness now?</div>
        <div className="mt-1 space-y-2">
          {hasAnchor && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="fk"
                checked={fitnessKind === 'existing'}
                onChange={() => setFitnessKind('existing')}
              />
              Use my current fitness (from recent training)
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="radio" name="fk" checked={fitnessKind === 'race'} onChange={() => setFitnessKind('race')} />
            From a recent race
          </label>
          {fitnessKind === 'race' && (
            <div className="space-y-2 pl-6">
              {recentRaces && recentRaces.length > 0 && (
                <div>
                  <div className="text-xs text-slate-500">Pick one of your recent runs:</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {recentRaces.map((r) => (
                      <button
                        key={r.day}
                        type="button"
                        onClick={() => {
                          setPickedDay(r.day);
                          if (DISTANCES.some((d) => d.value === r.distanceLabel)) setFitDistance(r.distanceLabel);
                          setFitTime(r.timeLabel);
                        }}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                          pickedDay === r.day
                            ? 'bg-violet-400/20 text-violet-100 ring-violet-400/40'
                            : 'bg-card text-slate-600 ring-slate-200 hover:bg-slate-50'
                        }`}
                        title={`${r.paceLabel} · ${r.day}`}
                      >
                        {r.distanceLabel} {r.timeLabel}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 text-xs text-slate-500">...or enter it yourself:</div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-600">
                  Distance
                  <select value={fitDistance} onChange={(e) => setFitDistance(e.target.value)} className={`block w-full ${field}`}>
                    {DISTANCES.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-600">
                  Time (e.g. 22:30)
                  <input
                    value={fitTime}
                    onChange={(e) => {
                      setFitTime(e.target.value);
                      setPickedDay(null);
                    }}
                    placeholder="22:30"
                    className={`block w-full ${field}`}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Volume */}
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-slate-600">
          Current weekly miles
          <input name="currentWeeklyMiles" type="number" min={3} max={150} defaultValue={20} className={`block w-full ${field}`} />
        </label>
        <label className="text-xs text-slate-600">
          Peak weekly miles (optional)
          <input name="peakWeeklyMiles" type="number" min={3} max={160} placeholder="auto" className={`block w-full ${field}`} />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50"
        >
          {pending ? 'Building your plan...' : submitLabel ?? (hasGoal ? 'Update goal & rebuild plan' : 'Set goal & build my plan')}
        </button>
        {hasGoal && (
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">
            Cancel
          </button>
        )}
      </div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
    </form>
  );
}
