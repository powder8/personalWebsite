/**
 * Route gating. Uses the edge-safe authConfig only (no adapter/DB) — the
 * `authorized` callback in auth.config.ts decides allow/deny from the JWT.
 * While auth is unconfigured it allows everything (staged rollout).
 */
import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';

// The `authorized` callback in authConfig decides allow/deny and Auth.js issues
// the sign-in redirect on deny, so the middleware is just the auth handler.
export default NextAuth(authConfig).auth;

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|txt|xml)$).*)'],
};
