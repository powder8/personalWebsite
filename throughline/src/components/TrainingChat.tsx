'use client';

import { useRef, useState } from 'react';

interface Action {
  tool: string;
  summary: string;
  ok: boolean;
}
interface Msg {
  role: 'user' | 'assistant';
  content: string;
  actions?: Action[];
}

const ATHLETE_STARTERS = [
  'What’s my workout today?',
  'How should today’s run feel?',
  'I need to take Friday off',
  'Am I on track for my goal race?',
];
const COACH_STARTERS = [
  'How is this athlete trending?',
  'Give them an easier week',
  'Move this week’s workout to Saturday',
  'What should they focus on?',
];

/**
 * "Ask about your training" — grounded chat over the athlete's own data that can
 * also ACT (days off, pace tweaks, fitness anchor). Used on both the athlete
 * portal (audience="athlete") and the coach console (audience="coach").
 */
export function TrainingChat({
  athleteId,
  configured,
  audience = 'athlete',
}: {
  athleteId: string;
  configured: boolean;
  audience?: 'coach' | 'athlete';
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const starters = audience === 'coach' ? COACH_STARTERS : ATHLETE_STARTERS;

  async function send(text: string) {
    const q = text.trim();
    if (!q || pending) return;
    setErr(null);
    setInput('');
    const next: Msg[] = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setPending(true);
    try {
      const res = await fetch(`/api/athletes/${athleteId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), audience }),
      });
      const j = await res.json();
      if (j.ok) {
        const actions: Action[] = Array.isArray(j.actions) ? j.actions : [];
        setMessages((m) => [...m, { role: 'assistant', content: j.reply, actions }]);
        setTimeout(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }), 50);
        // If the chat changed the plan, refresh so the page reflects it.
        if (actions.some((a) => a.ok)) setTimeout(() => window.location.reload(), 2500);
      } else setErr(j.error ?? 'Something went wrong.');
    } catch {
      setErr('Network error.');
    } finally {
      setPending(false);
    }
  }

  if (!configured) {
    return (
      <p className="text-sm text-slate-500">
        Ask-your-coach chat isn’t turned on yet. (Needs an Anthropic API key.)
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {starters.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div ref={scroller} className="max-h-80 space-y-3 overflow-y-auto rounded border border-slate-100 p-3">
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
              <span
                className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  m.role === 'user' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-800'
                }`}
              >
                {m.content}
              </span>
              {m.actions && m.actions.length > 0 && (
                <div className={`mt-1.5 space-y-1 ${m.role === 'user' ? 'text-right' : ''}`}>
                  {m.actions.map((a, j) => (
                    <div
                      key={j}
                      className={`inline-block rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${
                        a.ok
                          ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                          : 'bg-rose-50 text-rose-700 ring-rose-200'
                      }`}
                    >
                      {a.ok ? '✓ ' : '✕ '}
                      {a.summary}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {pending && <div className="text-xs text-slate-400">thinking…</div>}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={audience === 'coach' ? 'Ask or change this athlete’s plan…' : 'Ask, or tell me to change something…'}
          disabled={pending}
          className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {err && <p className="text-xs text-rose-600">{err}</p>}
      <p className="text-[11px] text-slate-400">
        Grounded in {audience === 'coach' ? 'this athlete’s' : 'your'} training data. Can adjust days off, paces, and
        fitness anchor — every change is coach-reviewable. Not medical advice.
      </p>
    </div>
  );
}
