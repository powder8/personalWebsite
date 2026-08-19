'use client';
/**
 * First-run onboarding for a self-service (no human coach) athlete:
 * welcome → connect your runs (Strava, optional) → fitness + goal → plan.
 * The final step reuses GoalSetup, which generates + publishes the plan, marks
 * the athlete onboarded, and lands them on their portal.
 */
import { useState } from 'react';
import { GoalSetup } from '@/components/GoalSetup';

type Step = 'welcome' | 'connect' | 'plan';

interface RecentRace {
  distanceLabel: string;
  timeLabel: string;
  distanceMeters: number;
  durationSeconds: number;
  day: string;
  paceLabel: string;
}

export function OnboardingWizard({
  athleteId,
  firstName,
  hasAnchor,
  stravaConfigured,
  recentRaces,
}: {
  athleteId: string;
  firstName: string;
  hasAnchor: boolean;
  stravaConfigured: boolean;
  recentRaces?: RecentRace[];
}) {
  // If runs already synced (came back from Strava), jump to the plan step.
  const [step, setStep] = useState<Step>(hasAnchor ? 'plan' : 'welcome');
  const [sex, setSex] = useState<'female' | 'male' | 'other' | null>(null);
  const steps: Step[] = ['welcome', 'connect', 'plan'];

  function pickSex(s: 'female' | 'male' | 'other') {
    setSex(s);
    // Save immediately (fire-and-forget) — gates cycle tracking, age-grading.
    fetch(`/api/athletes/${athleteId}/profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sex: s }),
    }).catch(() => {});
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      {/* progress dots */}
      <div className="mb-6 flex items-center justify-center gap-2">
        {steps.map((s) => (
          <span
            key={s}
            className={`h-1.5 rounded-full transition-all ${s === step ? 'w-8 bg-lime-300' : 'w-4 bg-slate-600'}`}
          />
        ))}
      </div>

      {step === 'welcome' && (
        <div className="rounded-3xl bg-gradient-to-br from-indigo-600/30 via-[#10141f] to-[#0c0f17] p-7 text-center shadow-lg ring-1 ring-inset ring-indigo-400/30">
          <h1 className="text-2xl font-extrabold tracking-tight text-white">Welcome, {firstName} 👋</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-700">
            Throughline is your automatic running coach. Tell us a little about where you are and what you’re chasing,
            and we’ll build, and keep adapting, a real day-by-day plan to get you there.
          </p>
          <button
            onClick={() => setStep('connect')}
            className="mt-6 rounded-full bg-lime-300 px-6 py-2.5 text-sm font-semibold text-[#0c1018] transition hover:bg-lime-200"
          >
            Let’s go
          </button>
        </div>
      )}

      {step === 'connect' && (
        <div className="rounded-3xl bg-[#11151f] p-7 shadow-lg ring-1 ring-inset ring-slate-700/50">
          <h2 className="text-xl font-bold tracking-tight text-white">Connect your runs</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">
            Linking Strava is the best start, we’ll import your history and read your current fitness automatically, so
            your paces are right from day one. You can always do this later.
          </p>
          <div className="mt-5 space-y-3">
            {stravaConfigured ? (
              <a
                href={`/api/auth/strava/connect?athleteId=${athleteId}`}
                className="block rounded-xl bg-[#fc4c02] px-4 py-3 text-center text-sm font-semibold text-white transition hover:opacity-90"
              >
                Connect Strava
              </a>
            ) : (
              <p className="rounded-xl bg-slate-800/60 px-4 py-3 text-center text-xs text-slate-400">
                Strava isn’t set up on this server yet, enter your fitness manually for now.
              </p>
            )}
            <button
              onClick={() => setStep('plan')}
              className="block w-full rounded-xl bg-slate-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-600"
            >
              I’ll enter my fitness manually
            </button>
          </div>
          <button
            onClick={() => setStep('welcome')}
            className="mt-4 text-xs text-slate-500 hover:underline"
          >
            ← Back
          </button>
        </div>
      )}

      {step === 'plan' && (
        <div className="rounded-3xl bg-[#11151f] p-7 shadow-lg ring-1 ring-inset ring-slate-700/50">
          <h2 className="text-xl font-bold tracking-tight text-white">Your fitness & goal</h2>
          <p className="mt-1 mb-4 text-sm text-slate-700">
            {hasAnchor
              ? 'Got your fitness from your runs. Now pick a goal and we’ll build the plan.'
              : 'A rough read of where you are and what you’re training for, we’ll handle the rest.'}
          </p>
          {/* Quick "about you", drives age-grading + whether cycle tracking shows */}
          <div className="mb-4">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">Sex (for pacing & tracking)</div>
            <div className="flex gap-2">
              {(['female', 'male', 'other'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => pickSex(s)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
                    sex === s ? 'bg-lime-300 text-[#0c1018] ring-lime-300' : 'bg-slate-800 text-slate-300 ring-slate-600 hover:bg-slate-700'
                  }`}
                >
                  {s[0].toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <GoalSetup
            athleteId={athleteId}
            hasAnchor={hasAnchor}
            hasGoal={false}
            startOpen
            redirectTo={`/me/${athleteId}`}
            submitLabel="Build my plan"
            recentRaces={recentRaces}
          />
          {!hasAnchor && (
            <button onClick={() => setStep('connect')} className="mt-4 text-xs text-slate-500 hover:underline">
              ← Back
            </button>
          )}
        </div>
      )}
    </div>
  );
}
