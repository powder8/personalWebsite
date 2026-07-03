/**
 * Whoop config, read from env only. Register a developer app at
 * https://developer.whoop.com to obtain the client id/secret.
 *
 * Registered app values (throughline.badoo.net):
 *   Redirect URL:  https://throughline.badoo.net/api/whoop/callback
 *   Webhook URL:   https://throughline.badoo.net/api/whoop/webhooks (V2)
 *   Scopes:        read:recovery read:cycles read:sleep read:workout
 *                  read:profile read:body_measurement
 */
export function whoopEnv() {
  return {
    clientId: process.env.WHOOP_CLIENT_ID ?? '',
    clientSecret: process.env.WHOOP_CLIENT_SECRET ?? '',
    redirectUri: process.env.WHOOP_REDIRECT_URI ?? '',
    authBaseUrl: 'https://api.prod.whoop.com/oauth/oauth2',
    // WHOOP API v2 (webhook version V2). v2 changed sleep/workout ids to UUIDs
    // and moved sleep under /activity/sleep.
    apiBaseUrl: process.env.WHOOP_API_BASE_URL ?? 'https://api.prod.whoop.com/developer/v2',
  };
}

export function whoopConfigured(): boolean {
  const e = whoopEnv();
  return !!(e.clientId && e.clientSecret && e.redirectUri);
}
