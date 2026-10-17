/**
 * Public marketing page — shown at '/' to signed-out visitors. Pure markup, no
 * data fetching. Shows the product instead of describing it: the hero carries a
 * preview of the real "Today" card, and each feature tile has a small piece of
 * the actual UI (a workout, a recovery trend, a goal verdict, a week).
 */
import Link from 'next/link';

const SPORTS = ['Run', 'Ride', 'Swim', 'Strength'];

const STEPS: { title: string; body: string }[] = [
  { title: 'Set a goal', body: 'Pick a race and a target time, or choose "build fitness". Add a recent result, or let your synced training set the starting point.' },
  { title: 'Train the plan', body: 'Each session spells out the reps, paces, and watts. Each week adapts to what you actually logged.' },
  { title: 'Check where you stand', body: 'One screen shows whether you are on track, how your body is handling the load, and what to do today.' },
];

export function LandingPage({ deleted = false }: { deleted?: boolean }) {
  return (
    <div className="space-y-24 overflow-x-clip pb-16 pt-6 sm:space-y-32 sm:pt-12">
      {deleted && (
        <p role="status" className="rounded-2xl bg-white/[0.06] px-4 py-3 text-sm text-slate-600">
          Your account and its data were deleted. Thanks for training with Throughline.
        </p>
      )}
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1 text-sm text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-lime-300" aria-hidden />
            {SPORTS.join(' · ')}
          </p>
          <h1 className="mt-6 text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.035em] text-white sm:text-6xl lg:text-7xl">
            A training plan that{' '}
            <span className="bg-gradient-to-r from-lime-200 via-lime-300 to-emerald-300 bg-clip-text text-transparent">keeps up with you</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-500">
            Throughline is an AI endurance coach. It rebuilds your plan around the sessions you actually do, how
            you recover, and where your fitness really is.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/signin"
              className="inline-flex h-12 items-center justify-center rounded-full bg-lime-300 px-7 text-[15px] font-semibold text-[#0a0a0b] transition hover:bg-lime-200"
            >
              Start free
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex h-12 items-center justify-center rounded-full bg-white/[0.07] px-7 text-[15px] font-semibold text-white transition hover:bg-white/[0.12]"
            >
              See how it works
            </a>
          </div>
        </div>

        <HeroPreview />
      </section>

      {/* ── FEATURES (bento) ─────────────────────────────────────────────── */}
      <section aria-labelledby="features">
        <h2 id="features" className="max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-5xl">
          Coaching that reads the whole picture
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-6">
          <Tile className="md:col-span-4" title="Workouts with real detail" body="Every session lists the warm-up, each rep, its target, and the recovery between reps.">
            <WorkoutMock />
          </Tile>
          <Tile className="md:col-span-2" title="Reads your recovery" body="Connect Whoop and the plan sees HRV, resting heart rate, and sleep. No wearable? A quick daily check-in works too.">
            <RecoveryMock />
          </Tile>
          <Tile className="md:col-span-2" title="An honest goal verdict" body="On track, a stretch, or not this race. Each verdict comes with the change that would move it.">
            <VerdictMock />
          </Tile>
          <Tile className="md:col-span-4" title="Every sport in one plan" body="Run, ride, swim, and strength share one weekly time budget, so no sport crowds out the others.">
            <WeekMock />
          </Tile>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="scroll-mt-24" aria-labelledby="how">
        <h2 id="how" className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">How it works</h2>
        <ol className="mt-10 grid gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-3xl bg-card p-6 ring-1 ring-inset ring-white/[0.06]">
              <span className="text-sm font-medium tabular-nums text-lime-300">0{i + 1}</span>
              <h3 className="mt-4 text-xl font-semibold text-white">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-slate-500">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
      <section className="surface-hero rounded-[2rem] px-6 py-16 text-center sm:py-20">
        <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-5xl">
          See your first week in two minutes
        </h2>
        <p className="mx-auto mt-4 max-w-md text-[15px] text-slate-500">Set a goal and get a plan built around you. Free to start.</p>
        <Link
          href="/signin"
          className="mt-8 inline-flex h-12 items-center rounded-full bg-lime-300 px-7 text-[15px] font-semibold text-[#0a0a0b] transition hover:bg-lime-200"
        >
          Start free
        </Link>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.06] pt-8 text-sm text-slate-500">
        <span>© {new Date().getFullYear()} Throughline</span>
        <Link href="/privacy" className="transition hover:text-white">
          Privacy
        </Link>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product previews (static markup that mirrors the real components)
// ---------------------------------------------------------------------------

function HeroPreview() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      {/* Soft volt glow behind the device. */}
      <div aria-hidden className="absolute -inset-10 -z-10 rounded-full bg-lime-300/10 blur-3xl" />
      <div className="rounded-[2.25rem] bg-[#111113] p-3 shadow-2xl ring-1 ring-white/10">
        <div className="rounded-[1.75rem] bg-[#0a0a0b] p-5">
          <p className="text-xs text-slate-500">Tuesday, Mar 10</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-white">
            Hi, <span className="text-lime-300">Sam</span>
          </p>

          <div className="surface-hero mt-5 rounded-3xl p-5">
            <div className="flex items-start gap-3">
              <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.06] text-lg">🚴</span>
              <div>
                <p className="text-xs text-slate-400">Today</p>
                <p className="text-2xl font-semibold leading-tight tracking-tight text-white">Threshold 60 min</p>
              </div>
            </div>
            <div className="mt-4 space-y-2 rounded-2xl bg-black/25 p-3.5 text-sm">
              <Row label="Warm up" value="15 min · 140–175 W" />
              <Row label="3 × 10 min" value="228–263 W" strong />
              <Row label="Between reps" value="5 min easy" />
              <Row label="Cool down" value="10 min" />
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-2xl bg-card px-4 py-3 ring-1 ring-inset ring-white/[0.06]">
            <div>
              <p className="text-xs text-slate-500">Recovery</p>
              <p className="text-sm font-semibold text-white">Ready to train</p>
            </div>
            <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">HRV +6%</span>
          </div>

          <div className="mt-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-inset ring-white/[0.06]">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-semibold text-white">Olympic Triathlon</p>
              <p className="text-xs text-slate-500">68 days</p>
            </div>
            <div className="relative mt-2.5 h-1.5 rounded-full bg-white/[0.08]">
              <div className="absolute inset-y-0 left-0 w-[72%] rounded-full bg-lime-300" />
              <div className="absolute -inset-y-1 left-[78%] w-0.5 rounded bg-white" />
            </div>
            <p className="mt-2 text-xs text-slate-400">On track for 2:38</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={strong ? 'font-semibold text-white' : 'text-slate-400'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-semibold text-lime-300' : 'text-slate-600'}`}>{value}</span>
    </div>
  );
}

function Tile({ title, body, className = '', children }: { title: string; body: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-3xl bg-card ring-1 ring-inset ring-white/[0.06] ${className}`}>
      <div className="flex min-h-44 flex-1 items-center justify-center bg-gradient-to-b from-white/[0.02] to-transparent p-6">{children}</div>
      <div className="p-6 pt-2">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="mt-1.5 text-[15px] leading-relaxed text-slate-500">{body}</p>
      </div>
    </div>
  );
}

function WorkoutMock() {
  // Interval blocks drawn to scale: warm-up, 5 reps with recoveries, cool-down.
  const blocks: { w: number; h: number; hot?: boolean }[] = [
    { w: 14, h: 30 },
    ...Array.from({ length: 5 }).flatMap(() => [{ w: 6, h: 82, hot: true }, { w: 3, h: 24 }]),
    { w: 10, h: 26 },
  ];
  return (
    <div className="flex h-28 w-full max-w-md items-end gap-1" aria-hidden>
      {blocks.map((b, i) => (
        <div
          key={i}
          className={`rounded-md ${b.hot ? 'bg-lime-300' : 'bg-white/[0.12]'}`}
          style={{ flexGrow: b.w, height: `${b.h}%` }}
        />
      ))}
    </div>
  );
}

function RecoveryMock() {
  const pts = [52, 48, 55, 50, 58, 61, 57, 63, 66, 62, 68];
  const max = 70;
  const min = 44;
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / (pts.length - 1)) * 200},${60 - ((v - min) / (max - min)) * 56}`).join(' ');
  return (
    <svg viewBox="0 0 200 64" className="h-24 w-full max-w-[14rem]" aria-hidden>
      <path d={`${d} L200,64 L0,64 Z`} fill="rgb(52 211 153 / 0.12)" />
      <path d={d} fill="none" stroke="rgb(52 211 153)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function VerdictMock() {
  return (
    <div className="w-full max-w-[14rem]" aria-hidden>
      <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
        <span className="h-2 w-2 rounded-full bg-emerald-400" /> On track
      </div>
      <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-white">1:44:20</p>
      <div className="relative mt-3 h-1.5 rounded-full bg-white/[0.08]">
        <div className="absolute inset-y-0 left-0 w-[80%] rounded-full bg-emerald-400" />
        <div className="absolute -inset-y-1 left-[76%] w-0.5 rounded bg-white" />
      </div>
    </div>
  );
}

function WeekMock() {
  const days: { d: string; s?: string; c?: string }[] = [
    { d: 'M', s: '🏃', c: 'bg-sky-400' },
    { d: 'T', s: '🚴', c: 'bg-lime-300' },
    { d: 'W', s: '🏊', c: 'bg-cyan-300' },
    { d: 'T', s: '🏃', c: 'bg-sky-400' },
    { d: 'F' },
    { d: 'S', s: '🚴', c: 'bg-lime-300' },
    { d: 'S', s: '💪', c: 'bg-violet-300' },
  ];
  return (
    <div className="grid w-full max-w-md grid-cols-7 gap-2" aria-hidden>
      {days.map((x, i) => (
        <div key={i} className="flex flex-col items-center gap-2 rounded-2xl bg-white/[0.04] py-3">
          <span className="text-xs text-slate-500">{x.d}</span>
          <span className="text-lg leading-none">{x.s ?? '·'}</span>
          <span className={`h-1 w-5 rounded-full ${x.c ?? 'bg-white/10'}`} />
        </div>
      ))}
    </div>
  );
}
