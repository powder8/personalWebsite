'use client';

import { useRef, useState } from 'react';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const STARTERS = [
  'Why is today the session it is?',
  'What should I focus on to get faster?',
  'How is my fitness trending?',
  'What are my goal-race paces?',
];

/**
 * "Ask about your training" — grounded chat over the athlete's own data.
 * Answers come from Claude with the athlete's readiness/plan/insights injected.
 */
export function TrainingChat({ athleteId, configured }: { athleteId: string; configured: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

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
        body: JSON.stringify({ messages: next }),
      });
      const j = await res.json();
      if (j.ok) {
        setMessages((m) => [...m, { role: 'assistant', content: j.reply }]);
        setTimeout(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }), 50);
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
          {STARTERS.map((s) => (
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
          placeholder="Ask about your training…"
          disabled={pending}
          className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
        >
          Ask
        </button>
      </form>
      {err && <p className="text-xs text-rose-600">{err}</p>}
      <p className="text-[11px] text-slate-400">
        Answers are grounded in your own training data. Coaching guidance, not medical advice.
      </p>
    </div>
  );
}
