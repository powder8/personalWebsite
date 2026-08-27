'use client';

import { useState } from 'react';

type TriDistance = 'sprint' | 'olympic' | '70.3' | 'ironman';
type Discipline = 'swim' | 'bike' | 'run';

const RUN_DISTANCES: { label: string; meters: number }[] = [
  { label: '5K', meters: 5000 },
  { label: '10K', meters: 10000 },
  { label: 'Half', meters: 21097.5 },
  { label: 'Marathon', meters: 42195 },
];

/** Forgiving clock parser → seconds. "22"→22:00, "6:40"→400s, "4:45:00"→h:m:s. */
function parseClock(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const parts = t.split(/[:.\s]+/).map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 1) return parts[0] * 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

const field = 'w-full rounded-xl bg-white/5 px-3 py-2 text-sm text-white ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-lime-400/40';
const label = 'block text-xs font-medium text-slate-400 mb-1';

const DOW = [0, 1, 2, 3, 4, 5, 6];
const DOW_LABEL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A compact 7-day toggle row (checkboxes named `${prefix}-${dow}`). */
function DayToggles({ prefix, defaults }: { prefix: string; defaults: number[] }) {
  return (
    <div className="flex gap-1">
      {DOW.map((i) => (
        <label
          key={i}
          className="flex-1 cursor-pointer select-none rounded-lg bg-white/5 py-1.5 text-center text-[11px] font-medium text-slate-300 ring-1 ring-inset ring-white/10 has-[:checked]:bg-lime-300/20 has-[:checked]:text-lime-200 has-[:checked]:ring-lime-400/40"
        >
          <input type="checkbox" name={`${prefix}-${i}`} defaultChecked={defaults.includes(i)} className="sr-only" />
          {DOW_LABEL[i]}
        </label>
      ))}
    </div>
  );
}

/**
 * Athlete-facing triathlon onboarding. Collects the three anchors, a target
 * finish, weekly hours + limiter, then builds a published multi-sport plan and
 * shows the honest binding-leg verdict inline.
 */
export function TriGoalSetup({
  athleteId,
  defaultDob,
  defaultWeightKg,
}: {
  athleteId: string;
  defaultDob?: string | null;
  defaultWeightKg?: number | null;
}) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ verdict: string | null; headline: string | null; note: string | null } | null>(null);
  // Phased triathlon: start bike + run now, add the swim in a later block.
  const [deferSwim, setDeferSwim] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const fd = new FormData(e.currentTarget);

    // Run race + FTP are OPTIONAL: leave them blank and the server seeds a
    // conservative starter estimate that refines as real runs/rides land.
    const runRaceMeters = RUN_DISTANCES.find((d) => d.label === String(fd.get('runDist')))?.meters ?? 0;
    const runTime = parseClock(String(fd.get('runTime') || ''));
    const ftp = Number(fd.get('ftp') || 0);
    const t400 = parseClock(String(fd.get('swim400') || ''));
    const t200 = parseClock(String(fd.get('swim200') || ''));
    const hasSwim = !!(t400 && t200);
    if (!deferSwim && !hasSwim) {
      return setErr('Add your 400 m and 200 m swim times, or check “I’ll start swimming later”.');
    }

    const targetRaw = String(fd.get('targetFinish') || '').trim();
    const targetFinishSeconds = targetRaw ? parseClock(targetRaw) ?? undefined : undefined;

    const availableDays = DOW.filter((i) => fd.get(`avail-${i}`) === 'on');
    const poolDays = DOW.filter((i) => fd.get(`pool-${i}`) === 'on');
    const longDayRaw = fd.get('longDay');
    const schedule = availableDays.length
      ? { availableDays, poolDays, longDay: longDayRaw != null && longDayRaw !== '' ? Number(longDayRaw) : undefined }
      : undefined;

    const body = {
      distance: String(fd.get('distance')) as TriDistance,
      name: String(fd.get('name') || '').trim() || undefined,
      date: String(fd.get('date') || ''),
      targetFinishSeconds,
      weeklyHours: Number(fd.get('weeklyHours') || 0),
      limiter: String(fd.get('limiter')) as Discipline,
      run: runTime && runRaceMeters ? { race: { distanceMeters: runRaceMeters, timeSeconds: runTime } } : {},
      bike: { ftpWatts: ftp > 0 ? ftp : undefined, weightKg: Number(fd.get('weightKg') || 0) || undefined },
      swim: hasSwim ? { test: { t400Sec: t400!, t200Sec: t200! } } : undefined,
      dateOfBirth: String(fd.get('dob') || '') || undefined,
      schedule,
    };

    setPending(true);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/tri-goal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (j.ok) {
        setResult({ verdict: j.verdict, headline: j.headline, note: j.note });
        setPending(false);
      } else {
        setErr(j.error ?? 'Failed.');
        setPending(false);
      }
    } catch {
      setErr('Network error.');
      setPending(false);
    }
  }

  if (result) {
    const tone =
      result.verdict === 'beyond_reach' ? 'ring-rose-400/30 bg-rose-400/10'
      : result.verdict === 'stretch' || result.verdict === 'unrealistic' ? 'ring-amber-400/30 bg-amber-400/10'
      : 'ring-emerald-400/30 bg-emerald-400/10';
    return (
      <div className="space-y-4">
        <div className={`rounded-2xl p-4 ring-1 ring-inset ${tone}`}>
          {result.headline && <h3 className="text-lg font-bold text-white">{result.headline}</h3>}
          {result.note && <p className="mt-1.5 text-sm leading-relaxed text-white/85">{result.note}</p>}
          {!result.headline && <p className="text-sm text-white/85">Your multi-sport plan is built and live.</p>}
        </div>
        <a
          href={`/me/${athleteId}`}
          className="inline-block rounded-full bg-lime-300 px-4 py-2 text-sm font-semibold text-[#0c1018] transition hover:bg-lime-200"
        >
          Go to my plan →
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Race */}
      <div>
        <label className={label}>Race name</label>
        <input name="name" placeholder="Maryland Triathlon" className={field} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Distance</label>
          <select name="distance" defaultValue="70.3" className={field}>
            <option value="sprint">Sprint</option>
            <option value="olympic">Olympic</option>
            <option value="70.3">Half (70.3)</option>
            <option value="ironman">Ironman</option>
          </select>
        </div>
        <div>
          <label className={label}>Race date</label>
          <input type="date" name="date" required className={field} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Target finish (optional)</label>
          <input name="targetFinish" placeholder="5:15:00" className={field} />
        </div>
        <div>
          <label className={label}>Date of birth</label>
          <input type="date" name="dob" defaultValue={defaultDob ?? undefined} className={field} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Training hours / week</label>
          <input type="number" name="weeklyHours" min="2" max="25" step="0.5" defaultValue="8" required className={field} />
        </div>
        <div>
          <label className={label}>Weakest sport</label>
          <select name="limiter" defaultValue="swim" className={field}>
            <option value="swim">Swim</option>
            <option value="bike">Bike</option>
            <option value="run">Run</option>
          </select>
        </div>
      </div>

      {/* Anchors */}
      <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-inset ring-white/10">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Where your fitness is now</div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          Don&apos;t know your 10K time or FTP? Leave them blank. I&apos;ll start from a sensible estimate and sharpen
          your plan automatically as you log real runs and rides.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className={label}>🏃 Recent run race (optional)</label>
            <select name="runDist" defaultValue="10K" className={field}>
              {RUN_DISTANCES.map((d) => (
                <option key={d.label} value={d.label}>{d.label === 'Half' ? 'Half Marathon' : d.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>...time</label>
            <input name="runTime" placeholder="47:30" className={field} />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className={label}>🚴 Bike FTP, watts (optional)</label>
            <input type="number" name="ftp" min="60" max="500" placeholder="est. from weight" className={field} />
          </div>
          <div>
            <label className={label}>Body weight (kg)</label>
            <input type="number" name="weightKg" min="35" max="160" step="0.5" defaultValue={defaultWeightKg ?? undefined} placeholder="74" className={field} />
          </div>
        </div>

        <label className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-300">
          <input type="checkbox" checked={deferSwim} onChange={(e) => setDeferSwim(e.target.checked)} className="h-4 w-4" />
          I&apos;ll start swimming later
        </label>
        {deferSwim ? (
          <p className="mt-2 text-[11px] text-slate-500">
            We&apos;ll build your bike and run now and add the swim when you start. Your goal card marks the swim
            leg &ldquo;not started&rdquo; until then.
          </p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className={label}>🏊 Swim 400 m time</label>
                <input name="swim400" placeholder="6:40" className={field} />
              </div>
              <div>
                <label className={label}>...and 200 m time</label>
                <input name="swim200" placeholder="3:10" className={field} />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              The 400 &amp; 200 swims set your CSS (critical swim speed). Best effort, fully rested between.
            </p>
          </>
        )}
      </div>

      {/* Real-world schedule */}
      <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-inset ring-white/10">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your week (optional)</div>
        <p className="mt-1 mb-3 text-[11px] text-slate-500">
          I&apos;ll lay swim/bike/run onto the days you can actually train, swims only on pool days, the long ride+run on your long day.
        </p>
        <div className="space-y-3">
          <div>
            <label className={label}>Days I can train</label>
            <DayToggles prefix="avail" defaults={[0, 1, 2, 3, 4, 5]} />
          </div>
          <div>
            <label className={label}>🏊 Pool-access days</label>
            <DayToggles prefix="pool" defaults={[1, 3]} />
          </div>
          <div>
            <label className={label}>Long day (big ride + run)</label>
            <select name="longDay" defaultValue="5" className={field}>
              <option value="">- none -</option>
              {DOW.map((i) => (
                <option key={i} value={i}>{DOW_LABEL[i]}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {err && <p className="text-sm text-rose-300">{err}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-lime-300 px-5 py-2.5 text-sm font-semibold text-[#0c1018] transition hover:bg-lime-200 disabled:opacity-50"
      >
        {pending ? 'Building your plan...' : 'Build my triathlon plan'}
      </button>
    </form>
  );
}
