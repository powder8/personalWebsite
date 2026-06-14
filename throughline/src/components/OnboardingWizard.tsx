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

export function OnboardingWizard({
  athleteId,
  firstName,
  hasAnchor,
  stravaConfigured,
}: {
  athleteId: string;
  firstName: string;
  hasAnchor: boolean;
  stravaConfigured: boolean;
}) {
  // If runs already synced (came back from Strava), jump to the plan step.
  const [step, setStep] = useState<Step>(hasAnchor ? 'plan' : 'welcome');
  const steps: Step[] = ['welcome', 'connect', 'plan'];

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
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-300">
            Throughline is your automatic running coach. Tell us a little about where you are and what you’re chasing,
            and we’ll build — and keep adapting — a real day-by-day plan to get you there.
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
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            Linking Strava is the best start — we’ll import your history and read your current fitness automatically, so
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
                Strava isn’t set up on this server yet — enter your fitness manually for now.
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
          <p className="mt-1 mb-4 text-sm text-slate-300">
            {hasAnchor
              ? 'Got your fitness from your runs. Now pick a goal and we’ll build the plan.'
              : 'A rough read of where you are and what you’re training for — we’ll handle the rest.'}
          </p>
          <GoalSetup
            athleteId={athleteId}
            hasAnchor={hasAnchor}
            hasGoal={false}
            startOpen
            redirectTo={`/me/${athleteId}`}
            submitLabel="Build my plan"
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
