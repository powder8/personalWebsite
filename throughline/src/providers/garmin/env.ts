/**
 * Garmin config, read from env only. Endpoints default to Garmin Connect
 * Developer Program production (OAuth2 PKCE spec); override per env for the
 * evaluation environment without a code change.
 */
export function garminEnv() {
  return {
    clientId: process.env.GARMIN_CLIENT_ID ?? '',
    clientSecret: process.env.GARMIN_CLIENT_SECRET ?? '',
    redirectUri: process.env.GARMIN_REDIRECT_URI ?? '',
    // Shared secret carried in the webhook URL registered with Garmin
    // (…/api/webhooks/garmin?key=<secret>). Garmin doesn't sign requests.
    webhookSecret: process.env.GARMIN_WEBHOOK_SECRET ?? '',
    authorizeUrl: process.env.GARMIN_AUTHORIZE_URL ?? 'https://connect.garmin.com/oauth2Confirm',
    tokenUrl: process.env.GARMIN_TOKEN_URL ?? 'https://connectapi.garmin.com/di-oauth2-service/oauth/token',
    apiBaseUrl: process.env.GARMIN_API_BASE_URL ?? 'https://apis.garmin.com',
  };
}

/** True once the app has Garmin Developer Program credentials. */
export function garminConfigured(): boolean {
  const e = garminEnv();
  return !!(e.clientId && e.clientSecret && e.redirectUri);
}
