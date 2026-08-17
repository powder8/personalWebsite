/**
 * Public marketing page — shown at '/' to signed-out visitors. Pure markup,
 * no data fetching. Follows the same visual language as the athlete portal
 * (dark gradient hero, lime accent CTA, ring-inset cards) so signing up feels
 * like a preview of the product, not a different site.
 */
import Link from 'next/link';

const VALUE_PROPS: { title: string; body: string; emoji: string }[] = [
  {
    emoji: '🏃',
    title: 'Workouts that actually say something',
    body: 'Not "6 miles threshold." A real session: how long the warm-up is and how fast, how long each rep is and at what pace, and whether the recovery is a jog, a walk, or standing rest, modeled on real coach-written training.',
  },
  {
    emoji: '🫀',
    title: 'Reads how your body is handling it',
    body: 'Connect a wearable and the plan sees HRV, resting heart rate, and sleep alongside your training load, and asks how you feel before it changes anything, rather than quietly deciding for you.',
  },
  {
    emoji: '🎯',
    title: 'An honest read on your goal',
    body: 'One verdict, always paired with the lever that moves it: on track, a real stretch, drifting off plan, or, when a goal genuinely is not this race, a straight answer and a realistic target instead.',
  },
  {
    emoji: '🤝',
    title: 'Coach-guided or fully autonomous',
    body: 'Train with a human coach in the loop reviewing every adjustment, or let the app run the whole plan and escalate to a coach only when something needs a person.',
  },
];

const STEPS: { n: string; title: string; body: string }[] = [
  { n: '1', title: 'Set your goal', body: 'A race and a target time, or just "build fitness." Add a recent race or your current pace and the plan is built around where you actually are.' },
  { n: '2', title: 'Train on a real plan', body: 'Every week adapts to what you log, specific sessions, not vague labels, with the reps and paces spelled out.' },
  { n: '3', title: 'See where you stand', body: 'One page tells you if you are on pace for your goal, how your body is responding, and exactly what to do about it.' },
];

export function LandingPage() {
  return (
    <div className="space-y-16 pb-12">
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 px-6 py-14 text-center shadow-lg sm:px-12 sm:py-20">
        <h1 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-5xl">
          Training that adapts as fast as you do
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-400 sm:text-lg">
          An AI coach that rebuilds your plan around real workouts, real recovery data, and where you actually
          stand.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/signin"
            className="rounded-full bg-lime-300 px-6 py-3 text-sm font-semibold text-[#0c1018] transition hover:bg-lime-200"
          >
            Get started, it&apos;s free
          </Link>
          <a
            href="#how-it-works"
            className="rounded-full px-6 py-3 text-sm font-semibold text-slate-400 ring-1 ring-inset ring-white/15 transition hover:bg-white/5"
          >
            See how it works
          </a>
        </div>
      </section>

      {/* ── VALUE PROPS ──────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-center text-xs font-semibold uppercase tracking-wide text-slate-400">
          What makes it different
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {VALUE_PROPS.map((v) => (
            <div key={v.title} className="rounded-2xl bg-card p-5 ring-1 ring-inset ring-slate-200/70">
              <div className="flex items-center gap-2">
                <span className="text-xl leading-none" aria-hidden>{v.emoji}</span>
                <h3 className="text-sm font-semibold text-slate-700">{v.title}</h3>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{v.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="scroll-mt-6">
        <h2 className="text-center text-xs font-semibold uppercase tracking-wide text-slate-400">How it works</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl bg-card p-5 ring-1 ring-inset ring-slate-200/70">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-lime-300 text-sm font-bold text-[#0c1018]">
                {s.n}
              </span>
              <h3 className="mt-3 text-sm font-semibold text-slate-700">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
      <section className="rounded-3xl bg-gradient-to-br from-[#141b2e] via-[#10141f] to-indigo-950 px-6 py-10 text-center shadow-lg">
        <h2 className="text-2xl font-bold tracking-tight text-white">Ready to train with a plan that adapts to you?</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
          Set a goal and see your first week, free.
        </p>
        <Link
          href="/signin"
          className="mt-6 inline-block rounded-full bg-lime-300 px-6 py-3 text-sm font-semibold text-[#0c1018] transition hover:bg-lime-200"
        >
          Sign in and set your goal
        </Link>
      </section>
    </div>
  );
}
