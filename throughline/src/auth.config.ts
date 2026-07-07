/**
 * Edge-safe Auth.js config — providers + route gating ONLY. No adapter, no DB
 * imports, so it can run in middleware (edge runtime). The Node half (adapter +
 * DB-backed callbacks) lives in src/auth.ts and spreads this in.
 *
 * Auth.js auto-reads AUTH_SECRET, AUTH_GOOGLE_ID/SECRET, AUTH_RESEND_KEY.
 */
import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import Resend from 'next-auth/providers/resend';

/** True once auth is configured for this environment (prod Neon + a secret). */
export function authConfigured(): boolean {
  const url = process.env.DATABASE_URL;
  return !!process.env.AUTH_SECRET && !!url && !url.includes('localhost');
}

const providers: NextAuthConfig['providers'] = [];
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google({ allowDangerousEmailAccountLinking: true }));
}
if (process.env.AUTH_RESEND_KEY) {
  providers.push(
    Resend({
      from: process.env.EMAIL_FROM || 'Throughline <onboarding@resend.dev>',
    }),
  );
}

/** Coach role is granted to these emails (comma-separated env). */
function isCoachEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.COACH_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/** Coach-only path prefixes (the console). Everything else is athlete-facing. */
const COACH_PREFIXES = ['/coach', '/athletes', '/escalations', '/feedback', '/import'];
/**
 * Paths anyone (even signed-out) may hit. Whoop OAuth (connect/callback) and its
 * webhook all live under /api/whoop and must be reachable without a session —
 * WHOOP's servers POST to the webhook with no cookies, and app reviewers open
 * /privacy. (The authenticated Whoop sync lives at /api/athletes/<id>/whoop/sync,
 * which stays gated by the athlete-ownership check below.)
 */
const PUBLIC_PREFIXES = ['/signin', '/privacy', '/api/auth', '/api/whoop', '/api/webhooks', '/api/inngest', '/api/cron'];

/**
 * Extract the athlete id an athlete-scoped path is addressing, so a non-coach
 * can only reach their OWN data. Matches /me/<id>, /availability/<id>, and
 * /api/athletes/<id>/...
 *
 * Athlete ids are UUIDs, so the /me and /availability segments are matched as
 * UUIDs specifically — otherwise a non-id helper route like /me/settings (which
 * resolves the athlete server-side and redirects) would be read as id="settings",
 * fail the ownership check, and bounce to /signin in an infinite loop.
 */
const UUID_RE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
function athleteIdFromPath(pathname: string): string | null {
  const m =
    pathname.match(new RegExp(`^/me/(${UUID_RE})`)) ||
    pathname.match(new RegExp(`^/availability/(${UUID_RE})`)) ||
    pathname.match(/^\/api\/athletes\/([^/]+)/);
  return m ? m[1] : null;
}

export const authConfig = {
  providers,
  trustHost: true,
  pages: { signIn: '/signin', verifyRequest: '/signin/check-email' },
  session: { strategy: 'jwt' },
  callbacks: {
    /**
     * Route gate for middleware. Returns true to allow. While auth is
     * unconfigured we allow everything (staged rollout — don't lock anyone out
     * before Google/Resend creds + coach seeding are in place).
     */
    authorized({ auth, request }) {
      if (!authConfigured()) return true;
      const { pathname } = request.nextUrl;
      // Exact match only — '/' must NOT be a startsWith prefix, or every path
      // would match it and the whole gate would be defeated. The root page
      // itself branches: signed-out visitors see the public marketing page;
      // signed-in users are redirected to their own home.
      if (pathname === '/') return true;
      if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;

      const role = auth?.user?.role;
      const signedIn = !!auth?.user;
      if (role === 'coach') return true; // coaches have full access

      // '/' is a role-aware redirect page (soon the public landing page), so any
      // signed-in user may hit it; the console itself lives under /coach.
      const needsCoach = COACH_PREFIXES.some((p) => pathname.startsWith(p));
      if (needsCoach) {
        // A signed-in ATHLETE on a coach-only path (incl. '/') must go to their
        // own area — NOT back to /signin, which would infinite-loop since they're
        // already authenticated. Only truly signed-out users get the sign-in page.
        if (signedIn) return Response.redirect(new URL('/me', request.nextUrl));
        return false;
      }
      if (!signedIn) return false;

      // Ownership: athlete-scoped paths must match the signed-in athlete.
      const ownedId = athleteIdFromPath(pathname);
      if (ownedId) return auth?.user?.athleteId === ownedId;
      return true;
    },
    /** Map token → session (edge-safe; no DB). Lets middleware read role/athleteId. */
    session({ session, token }) {
      if (session.user) {
        session.user.role = (token.role as 'coach' | 'athlete' | undefined) ?? 'athlete';
        session.user.athleteId = (token.athleteId as string | null | undefined) ?? null;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export { isCoachEmail };
