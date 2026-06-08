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
  if (session?.user) redirect(callbackUrl || (session.user.role === 'coach' ? '/' : '/me'));

  const googleEnabled = !!process.env.AUTH_GOOGLE_ID;
  const emailEnabled = !!process.env.AUTH_RESEND_KEY;

  return (
    <div className="mx-auto max-w-md py-16">
      <h1 className="text-center text-2xl font-semibold text-slate-900">Sign in to Throughline</h1>
      <p className="mt-1 text-center text-sm text-slate-500">Coaches and athletes.</p>

      {error && (
        <p className="mt-4 rounded bg-rose-50 px-3 py-2 text-center text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          {error === 'AccessDenied' ? 'That account isn’t recognized yet.' : 'Sign-in failed — please try again.'}
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
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <GoogleMark /> Continue with Google
            </button>
          </form>
        )}

        {googleEnabled && emailEnabled && (
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
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
            <label className="block text-sm text-slate-600">
              Email
              <input
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              className="w-full rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-800"
            >
              Email me a sign-in link
            </button>
          </form>
        )}
      </div>
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
