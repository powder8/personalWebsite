import 'server-only';
/**
 * Server wrapper over oauthStateLogic: supplies the signing secret and the
 * cookie name/options for the Whoop & Strava OAuth flows. See oauthStateLogic
 * for the CSRF model.
 */
import { issueState, verifyState } from './oauthStateLogic';

// AUTH_SECRET is set in every real (configured) environment; the dev fallback
// only matters on localhost where the flow isn't a real attack surface.
const SECRET = process.env.AUTH_SECRET || 'throughline-dev-oauth-secret';

export type OAuthProvider = 'whoop' | 'strava';

export function oauthCookieName(provider: OAuthProvider): string {
  return `tl_oauth_${provider}`;
}

export interface IssuedOAuthState {
  state: string;
  cookie: {
    name: string;
    value: string;
    options: { httpOnly: true; secure: boolean; sameSite: 'lax'; path: string; maxAge: number };
  };
}

export function issueOAuthState(provider: OAuthProvider, athleteId: string): IssuedOAuthState {
  const { state, cookieValue } = issueState(SECRET, athleteId);
  return {
    state,
    cookie: {
      name: oauthCookieName(provider),
      value: cookieValue,
      // lax so the cookie rides the provider's top-level redirect back to us.
      options: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600 },
    },
  };
}

/** The bound athleteId iff the callback state matches the connect-time cookie. */
export function verifyOAuthState(stateParam: string | null, cookieValue: string | undefined): string | null {
  return verifyState(SECRET, stateParam, cookieValue);
}
