'use client';

import { useState } from 'react';

/**
 * Athlete-facing "about you" — date of birth + sex. Powers the Health page's
 * age/sex comparisons (VO2max & resting-HR percentiles, fitness age). Posts to
 * the guarded /profile route (which already accepts both fields).
 *
 * `sex` is the biological basis the physiological norms are built on (FRIEND /
 * ACSM tables are male/female); it's kept separate from identity, and
 * "Prefer not to say" maps to `other` → no age/sex percentile (same as unset).
 */
const SEX_OPTIONS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Prefer not to say' },
];

export function AboutYou({
  athleteId,
  initialDob,
  initialSex,
}: {
  athleteId: string;
  initialDob: string | null;
  initialSex: string | null;
}) {
  const [dob, setDob] = useState(initialDob ?? '');
  const [sex, setSex] = useState(initialSex ?? '');
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setErr(null);
    setSaved(false);
    try {
      const body: { dateOfBirth: string | null; sex?: string } = { dateOfBirth: dob || null };
      if (sex) body.sex = sex;
      const res = await fetch(`/api/athletes/${athleteId}/profile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        setSaved(true);
        setTimeout(() => window.location.reload(), 700);
      } else setErr(json.error ?? 'Failed.');
    } catch {
      setErr('Network error.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Powers your <span className="font-medium text-slate-600">Health</span> comparisons, the age/sex
        percentiles and fitness age. We use sex only for the physiological norms (VO2max, resting HR); it&apos;s
        separate from how you identify.
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-xs text-slate-600">
          Date of birth
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="mt-0.5 block rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-slate-600">
          Sex (for health norms)
          <select
            value={sex}
            onChange={(e) => setSex(e.target.value)}
            className="mt-0.5 block rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Select...</option>
            {SEX_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={pending}
          className="rounded bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
        >
          {pending ? 'Saving...' : 'Save'}
        </button>
        {saved && <span className="text-sm text-emerald-300">Saved ✓</span>}
        {err && <span className="text-sm text-rose-600">{err}</span>}
      </div>
    </div>
  );
}
