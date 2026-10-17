'use client';

import { useEffect, useRef, useState } from 'react';

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
 * "Ask about your training" — a conversational chat (Claude/ChatGPT-style: message
 * flow + a rounded composer with Enter-to-send) that can answer questions and
 * take actions. Used on the athlete portal (audience="athlete") and the coach
 * console (audience="coach").
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
  const taRef = useRef<HTMLTextAreaElement>(null);
  const starters = audience === 'coach' ? COACH_STARTERS : ATHLETE_STARTERS;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending]);

  function grow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || pending) return;
    setErr(null);
    setInput('');
    requestAnimationFrame(grow);
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

  const empty = messages.length === 0;

  return (
    <div className="flex flex-col">
      {/* conversation */}
      <div
        ref={scroller}
        className={`overflow-y-auto ${empty ? '' : 'max-h-[28rem] pr-1'}`}
      >
        {empty ? (
          <div className="py-6 text-center">
            <p className="text-sm text-slate-500">
              {audience === 'coach'
                ? 'Ask about this athlete, or tell me to change their plan.'
                : 'Ask about your training, or tell me to change something.'}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {starters.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full bg-white/[0.06] px-3.5 py-2 text-sm text-slate-700 transition hover:bg-white/[0.1]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5 py-2">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={m.role === 'user' ? 'max-w-[85%]' : 'w-full'}>
                  {m.role === 'assistant' && (
                    <div className="mb-1 text-xs font-medium text-slate-400">Coach</div>
                  )}
                  <div
                    className={
                      m.role === 'user'
                        ? 'whitespace-pre-wrap rounded-3xl rounded-br-md bg-[#26262a] px-4 py-2.5 text-[15px] text-white'
                        : 'whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800'
                    }
                  >
                    {m.content}
                  </div>
                  {m.actions && m.actions.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {m.actions.map((a, j) => (
                        <div
                          key={j}
                          className={`inline-flex items-start gap-1 rounded-lg px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${
                            a.ok ? 'bg-emerald-400/10 text-emerald-200 ring-emerald-400/30' : 'bg-rose-400/10 text-rose-300 ring-rose-400/30'
                          }`}
                        >
                          <span>{a.ok ? '✓' : '✕'}</span>
                          <span>{a.summary}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {pending && (
              <div className="flex justify-start">
                <div className="w-full">
                  <div className="mb-1 text-xs font-medium text-slate-400">Coach</div>
                  <div className="flex gap-1 py-1" aria-label="Thinking">
                    <Dot /> <Dot delay="150ms" /> <Dot delay="300ms" />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3"
      >
        <div className="flex items-end gap-2 rounded-[1.75rem] bg-[#1b1b1e] py-2 pl-5 pr-2 ring-1 ring-inset ring-white/[0.08] transition focus-within:ring-white/20">
          <textarea
            ref={taRef}
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value);
              grow();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={
              audience === 'coach' ? 'Message your coaching assistant...' : 'Message your coach... (Enter to send)'
            }
            disabled={pending}
            className="max-h-40 flex-1 resize-none bg-transparent py-2 text-[15px] text-white outline-none placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#0a0a0b] transition hover:bg-slate-800 disabled:bg-white/10 disabled:text-slate-500"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </form>

      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
      <p className="mt-2 text-[11px] text-slate-400">
        Grounded in {audience === 'coach' ? 'this athlete’s' : 'your'} training data. Can adjust days off, paces, and
        the fitness anchor, every change is coach-reviewable. Not medical advice.
      </p>
    </div>
  );
}

function Dot({ delay = '0ms' }: { delay?: string }) {
  return <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: delay }} />;
}
