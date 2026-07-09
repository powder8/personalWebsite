/**
 * Root. Signed-out visitors see the public marketing page (this is now an
 * exact-match public path in auth.config.ts — see the comment there for why
 * it must NOT be a startsWith prefix). Signed-in users are sent to their own
 * home: coaches to /coach, athletes to /me (which itself branches to
 * onboarding if they haven't finished setup).
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { authConfigured } from '@/auth.config';
import { LandingPage } from '@/components/LandingPage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Throughline — Your smart, adaptive running coach',
  description:
    'An AI running coach that rebuilds your plan around real workouts, real recovery data, and where you actually stand.',
};

export default async function RootPage() {
  if (!authConfigured()) return <LandingPage />; // local dev without auth configured

  const session = await auth();
  if (!session?.user) return <LandingPage />;
  redirect(session.user.role === 'coach' ? '/coach' : '/me');
}
