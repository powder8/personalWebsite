/**
 * Garmin config, read from env only. Keeps the eval vs production environment
 * swap to a config change — never a code change.
 */
export function garminEnv() {
  return {
    clientId: process.env.GARMIN_CLIENT_ID ?? '',
    clientSecret: process.env.GARMIN_CLIENT_SECRET ?? '',
    redirectUri: process.env.GARMIN_REDIRECT_URI ?? '',
    webhookSecret: process.env.GARMIN_WEBHOOK_SECRET ?? '',
    // Eval first, then production — both come from env.
    authBaseUrl: process.env.GARMIN_AUTH_BASE_URL ?? 'https://connect.garmin.com',
    apiBaseUrl: process.env.GARMIN_API_BASE_URL ?? 'https://apis.garmin.com',
  };
}
