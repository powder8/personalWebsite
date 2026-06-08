import type { DefaultSession } from 'next-auth';

/** Extra fields we put on the session/JWT: app role + linked athlete record. */
declare module 'next-auth' {
  interface Session {
    user: {
      role: 'coach' | 'athlete';
      athleteId: string | null;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: 'coach' | 'athlete';
    athleteId?: string | null;
  }
}
