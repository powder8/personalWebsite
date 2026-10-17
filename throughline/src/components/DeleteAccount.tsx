'use client';
/**
 * Permanently delete the account. States exactly what goes, and requires
 * typing DELETE before the button works.
 */
import { useActionState, useState } from 'react';
import type { DeleteState } from '@/app/me/[id]/settings/actions';

export function DeleteAccount({ action }: { action: (prev: DeleteState, formData: FormData) => Promise<DeleteState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [typed, setTyped] = useState('');
  return (
    <form action={formAction} className="space-y-3">
      <p className="text-sm text-slate-500">This permanently deletes:</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-500">
        <li>Your profile, goals, and training plans</li>
        <li>Every synced activity, and your health data (sleep, HRV, resting heart rate, weight)</li>
        <li>Your check-ins, notes, and coach chat context</li>
        <li>Your connections to Strava, Whoop, and Garmin (we revoke our access at each one)</li>
      </ul>
      <p className="text-sm text-slate-500">You can&apos;t undo this. Data on Strava, Whoop, and Garmin stays with them.</p>
      <label className="block text-sm text-slate-600">
        Type <span className="font-semibold text-white">DELETE</span> to confirm
        <input
          name="confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          className="mt-1.5 block w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm sm:w-60"
        />
      </label>
      <button
        type="submit"
        disabled={pending || typed.trim().toUpperCase() !== 'DELETE'}
        className="rounded-full bg-rose-500/90 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-40"
      >
        {pending ? 'Deleting…' : 'Delete my account'}
      </button>
      {state.error && <p role="alert" className="text-sm text-rose-300">{state.error}</p>}
    </form>
  );
}
