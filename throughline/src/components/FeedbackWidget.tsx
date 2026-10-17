'use client';

import { useState } from 'react';

const CATEGORIES = ['plans', 'paces', 'races', 'readiness', 'ui', 'bug', 'idea', 'other'];

/**
 * `sentAs` is shown, not submitted: the server records the signed-in user as
 * the author and ignores any name in the request.
 */
export function FeedbackWidget({ sentAs }: { sentAs?: string | null }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category: String(fd.get('category') || ''),
          body: String(fd.get('body') || ''),
          path: typeof window !== 'undefined' ? window.location.pathname : '',
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setDone(true);
        setTimeout(() => {
          setOpen(false);
          setDone(false);
        }, 1400);
      } else setErr(json.error ?? 'Failed.');
    } catch {
      setErr('Network error.');
    } finally {
      setPending(false);
    }
  }

  const field = 'mt-0.5 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm';

  return (
    <div className="fixed bottom-20 right-4 z-50 sm:bottom-4">
      {open ? (
        <div className="w-80 rounded-3xl bg-card p-5 shadow-2xl ring-1 ring-inset ring-white/10">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-800">Feedback</span>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700">
              ✕
            </button>
          </div>
          {done ? (
            <p className="py-4 text-center text-sm text-emerald-300">Thanks. We got your feedback.</p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-2">
              <p className="text-xs text-slate-500">
                What would you change on this page? We save the page address with your note.
              </p>
              <div>
                <label className="block text-xs text-slate-600">
                  Topic
                  <select name="category" defaultValue="ui" className={field}>
                    {CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-xs text-slate-600">
                Message
                <textarea name="body" required rows={4} className={field} placeholder="I'd build this differently because..." />
              </label>
              <button
                type="submit"
                disabled={pending}
                className="w-full rounded-full bg-white px-3 py-2.5 text-sm font-semibold text-[#0a0a0b] transition hover:bg-slate-800 disabled:opacity-50"
              >
                {pending ? 'Sending...' : 'Send feedback'}
              </button>
              {sentAs && <p className="text-center text-xs text-slate-500">Sent as {sentAs}</p>}
              {err && <p className="text-xs text-rose-600">{err}</p>}
            </form>
          )}
        </div>
      ) : (
        // A quiet round button: always reachable, never louder than the content.
        <button
          onClick={() => setOpen(true)}
          aria-label="Send feedback"
          title="Send feedback"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1b1b1e]/90 text-slate-400 shadow-lg ring-1 ring-inset ring-white/10 backdrop-blur transition hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </button>
      )}
    </div>
  );
}
