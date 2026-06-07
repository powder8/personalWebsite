/**
 * Strava config, read from env only. Register an API application at
 * https://www.strava.com/settings/api to obtain the client id/secret, and set
 * the Authorization Callback Domain to this app's host.
 */
export function stravaEnv() {
  return {
    clientId: process.env.STRAVA_CLIENT_ID ?? '',
    clientSecret: process.env.STRAVA_CLIENT_SECRET ?? '',
    redirectUri: process.env.STRAVA_REDIRECT_URI ?? '',
    // Shared secret echoed back during webhook subscription validation.
    verifyToken: process.env.STRAVA_VERIFY_TOKEN ?? 'throughline',
    subscriptionId: process.env.STRAVA_SUBSCRIPTION_ID ?? '',
    authBaseUrl: process.env.STRAVA_AUTH_BASE_URL ?? 'https://www.strava.com',
    apiBaseUrl: process.env.STRAVA_API_BASE_URL ?? 'https://www.strava.com/api/v3',
  };
}

export function stravaConfigured(): boolean {
  const e = stravaEnv();
  return !!(e.clientId && e.clientSecret && e.redirectUri);
}
