# Authentication — setup & go-live

Throughline uses **Auth.js v5** (next-auth) with the Drizzle adapter. Two
sign-in methods: **Google OAuth** and **passwordless email magic links**
(via Resend). Sessions are JWT; route gating happens in `middleware.ts`.

## How it's wired

- `src/auth.config.ts` — edge-safe config (providers, route gate, session
  mapping). Used by `middleware.ts`. No DB.
- `src/auth.ts` — Node config: Drizzle adapter + the `jwt` callback that, at
  sign-in, grants the **coach** role to known emails and links the athlete
  record by email. Exports `auth`, `signIn`, `signOut`, `handlers`.
- `src/app/api/auth/[...nextauth]/route.ts` — Auth.js handlers.
- `src/app/signin` — sign-in + "check your email" pages.
- Tables (migration 0009): `users`, `accounts`, `sessions`,
  `verification_tokens`, plus `users.role` and `athletes.user_id`.

## Roles & linking

- `COACH_EMAILS` (comma-separated) → these sign-ins get `role = coach` (full
  console). Everyone else is an `athlete`.
- On first sign-in, the athlete whose `athletes.email` matches the account is
  bound via `athletes.user_id`, and the token carries that `athleteId`. The
  athlete can then only reach **their own** `/me/<id>` and `/api/athletes/<id>/*`
  (enforced in middleware); coaches reach everything.

## Staged rollout (no lockout)

`authConfigured()` is true only when `AUTH_SECRET` is set **and** `DATABASE_URL`
is a non-local (Neon) URL. Until then the `authorized` gate **allows everything**
— so deploying this code does not lock anyone out before the env + Google/Resend
setup is done. Flip auth on by setting the env vars below in Vercel.

## Go-live checklist

1. **Secret:** `npx auth secret` → set `AUTH_SECRET` in Vercel (Production).
2. **Google OAuth:** Google Cloud Console → APIs & Services → Credentials →
   *Create OAuth client ID* (Web). Authorized redirect URI:
   `https://throughline.badoo.net/api/auth/callback/google`. Set
   `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.
3. **Email magic links:** verify your sending domain in Resend, set
   `AUTH_RESEND_KEY` and `EMAIL_FROM` (e.g. `Throughline <coach@yourdomain>`).
4. **Coaches:** set `COACH_EMAILS` (Peter, Heather).
5. **Athlete emails:** make sure each `athletes.email` matches the address the
   athlete will sign in with (so linking works on first sign-in).
6. Redeploy. Visit `/signin`. Coaches land on the console; athletes on `/me`.

## Notes

- `allowDangerousEmailAccountLinking` is on for Google so signing in with Google
  and a magic link to the same address resolve to one account. Fine here
  (single trusted org); revisit if you open public signups.
- Existing `/me/<id>` personal links keep working for coaches; once auth is on,
  athletes must be signed in to use them.
