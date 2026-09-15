'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function RecoveryAdjustment({ athleteId, day, active = [] }: {
  athleteId: string; day: string; active?: { from: string; to: string | null; type: string }[];
}) {
  const router = useRouter();
  const [days, setDays] = useState(1);
  const [saving, setSaving] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pending = saving || refreshing;
  async function choose(mode: 'easy' | 'rest' | 'clear', from = day) {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/recovery-adjustment`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ day: from, days, mode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not update the plan.');
      startTransition(() => router.refresh());
    } catch (e) { setError(e instanceof Error ? e.message : 'Please retry.'); }
    finally { setSaving(false); }
  }
  return <div className="mt-4 border-t border-white/10 pt-4">
    {active.map((a) => <div key={a.from} className="mb-3 rounded-xl bg-lime-300/10 p-3 text-sm">
      <p className="font-semibold text-lime-200">{a.type === 'unavailable' ? 'Recovery break' : 'Easy training'} through {a.to}</p>
      <p className="mt-1 text-slate-600">Applied across your sports. Dates stay in place; missed work is not added later.</p>
      <button disabled={pending} onClick={() => choose('clear', a.from)} className="mt-1 min-h-11 text-sm font-semibold underline underline-offset-4">Undo this adjustment</button>
    </div>)}
    <details>
      <summary className="min-h-11 cursor-pointer text-sm font-semibold text-lime-200">Need to take a step back?</summary>
      <p className="mb-3 text-sm text-slate-600">Choose easy effort at 70% of planned volume, or rest. This changes all planned sports, including race days. Review how you feel before returning to the original plan.</p>
      <label className="text-sm">For
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={pending} className="ml-3 min-h-11 rounded-lg border border-slate-300 bg-slate-50 px-3">
          <option value={1}>Today</option><option value={3}>3 days</option><option value={7}>7 days</option>
        </select>
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={pending} onClick={() => choose('easy')} className="min-h-11 rounded-xl bg-lime-300 px-4 text-sm font-semibold text-[#10141f] disabled:opacity-50">{pending ? 'Updating…' : 'Make it easy'}</button>
        <button disabled={pending} onClick={() => choose('rest')} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50">Take a recovery break</button>
      </div>
    </details>
    {error && <p role="alert" className="mt-2 text-sm text-rose-300">{error}</p>}
  </div>;
}
