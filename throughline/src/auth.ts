/**
 * Node-side Auth.js: the edge-safe authConfig (providers + route gate) plus the
 * Drizzle adapter and DB-backed callbacks. Imported by the route handler and by
 * server components/pages via `auth()`. NOT imported by middleware (that uses
 * auth.config only, to stay edge-safe and DB-free).
 *
 * Session strategy is JWT so middleware can gate routes without a DB read; the
 * jwt callback enriches the token with role + linked athleteId at sign-in.
 */
import NextAuth from 'next-auth';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { users, accounts, sessions, verificationTokens, athletes } from '@/db/schema';
import { authConfig, authConfigured, isCoachEmail } from '@/auth.config';

function authDb() {
  return drizzle(neon(process.env.DATABASE_URL!), { schema });
}

// A dedicated synchronous Neon client for the adapter (the app's getDb() is
// async/memoized; the adapter needs a plain drizzle instance). Only built when
// auth is configured for this env.
const db = authConfigured() ? authDb() : undefined;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: db
    ? DrizzleAdapter(db, {
        usersTable: users,
        accountsTable: accounts,
        sessionsTable: sessions,
        verificationTokensTable: verificationTokens,
      })
    : undefined,
  callbacks: {
    ...authConfig.callbacks,
    /** At sign-in, enrich the token: grant coach role to known emails and link
     *  the athlete record (by email) so the token carries role + athleteId. */
    async jwt({ token, user }) {
      if (user?.email && db) {
        const coach = isCoachEmail(user.email);
        let [athlete] = await db
          .select({ id: athletes.id, userId: athletes.userId })
          .from(athletes)
          .where(eq(athletes.email, user.email))
          .limit(1);
        // First sign-in: bind this athlete record to the user account.
        if (athlete && !athlete.userId && user.id) {
          await db.update(athletes).set({ userId: user.id, updatedAt: new Date() }).where(eq(athletes.id, athlete.id));
        }
        // Self-service: a non-coach with no athlete record yet gets one created
        // (autonomous — no human coach), so the front door is never locked. The
        // onboarding wizard then collects their fitness + goal.
        if (!athlete && !coach && user.id) {
          const [created] = await db
            .insert(athletes)
            .values({
              fullName: user.name?.trim() || user.email.split('@')[0],
              email: user.email,
              userId: user.id,
              coachingMode: 'autonomous',
            })
            .returning({ id: athletes.id, userId: athletes.userId });
          athlete = created;
        }
        if (coach && user.id) {
          await db.update(users).set({ role: 'coach' }).where(eq(users.id, user.id));
        }
        token.role = coach ? 'coach' : 'athlete';
        token.athleteId = athlete?.id ?? null;
      }
      return token;
    },
    // `session` + `authorized` callbacks come from authConfig (edge-safe).
  },
});
