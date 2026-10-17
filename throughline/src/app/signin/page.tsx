import { redirect } from 'next/navigation';
import { signIn, auth } from '@/auth';
import { authConfigured } from '@/auth.config';

export const dynamic = 'force-dynamic';

/**
 * Sign-in: Google OAuth + passwordless email magic link. Server actions call
 * Auth.js directly. If auth isn't configured for this env yet, we say so rather
 * than render broken buttons.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;

  if (!authConfigured()) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Sign-in isn’t set up yet</h1>
        <p className="mt-2 text-sm text-slate-500">
          Authentication is configured at deploy time (Google + email). Until then the app is open.
        </p>
      </div>
    );
  }

  // Already signed in? Send them on.
  const session = await auth();
  if (session?.user) redirect(callbackUrl || (session.user.role === 'coach' ? '/coach' : '/me'));

  const googleEnabled = !!process.env.AUTH_GOOGLE_ID;
  const emailEnabled = !!process.env.AUTH_RESEND_KEY;

  return (
    <div className="mx-auto max-w-sm py-12 sm:py-20">
      <div className="rounded-[2rem] bg-card p-7 ring-1 ring-inset ring-white/[0.06] sm:p-9">
      <span aria-hidden className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-lime-300">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="#0a0a0b" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 17l5-5 4 3 9-9" />
        </svg>
      </span>
      <h1 className="mt-6 text-center text-[1.75rem] font-semibold tracking-tight text-white">Welcome to Throughline</h1>
      <p className="mt-2 text-center text-[15px] text-slate-500">Sign in or create an account to see your plan.</p>

      {error && (
        <p className="mt-6 rounded-2xl bg-rose-400/10 px-4 py-3 text-center text-sm text-rose-300 ring-1 ring-inset ring-rose-400/25">
          {error === 'AccessDenied' ? 'That account isn’t recognized yet.' : 'Sign-in failed, please try again.'}
        </p>
      )}

      <div className="mt-8 space-y-4">
        {googleEnabled && (
          <form
            action={async () => {
              'use server';
              await signIn('google', { redirectTo: callbackUrl || '/' });
            }}
          >
            <button
              type="submit"
              className="flex h-12 w-full items-center justify-center gap-2.5 rounded-full bg-white px-4 text-[15px] font-semibold text-[#0a0a0b] transition hover:bg-slate-800"
            >
              <GoogleMark /> Continue with Google
            </button>
          </form>
        )}

        {googleEnabled && emailEnabled && (
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-white/[0.08]" /> or <span className="h-px flex-1 bg-white/[0.08]" />
          </div>
        )}

        {emailEnabled && (
          <form
            action={async (formData: FormData) => {
              'use server';
              const email = String(formData.get('email') || '').trim();
              if (email) await signIn('resend', { email, redirectTo: callbackUrl || '/' });
            }}
            className="space-y-2"
          >
            <label className="block px-1 text-sm text-slate-500">
              Email
              <input
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                className="mt-1.5 block h-12 w-full rounded-full border border-white/10 bg-white/[0.04] px-5 text-[15px]"
              />
            </label>
            <button
              type="submit"
              className="h-12 w-full rounded-full bg-white/[0.08] px-4 text-[15px] font-semibold text-white transition hover:bg-white/[0.12]"
            >
              Email me a sign-in link
            </button>
          </form>
        )}
      </div>
      </div>
      <p className="mt-6 text-center text-xs text-slate-500">
        By continuing you agree to how we handle your data in the{' '}
        <a href="/privacy" className="underline hover:text-white">privacy policy</a>.
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 2.9 14.7 2 12 2 6.9 2 2.8 6.1 2.8 12S6.9 22 12 22c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z" />
    </svg>
  );
}
