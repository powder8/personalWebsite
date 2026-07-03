/**
 * Whoop config, read from env only. Register a developer app at
 * https://developer.whoop.com to obtain the client id/secret. Set the
 * Authorization Callback URL to WHOOP_REDIRECT_URI in your app settings.
 */
export function whoopEnv() {
  return {
    clientId: process.env.WHOOP_CLIENT_ID ?? '',
    clientSecret: process.env.WHOOP_CLIENT_SECRET ?? '',
    redirectUri: process.env.WHOOP_REDIRECT_URI ?? '',
    // Optional: HMAC secret for verifying webhook signatures (set in Whoop dev portal).
    webhookSecret: process.env.WHOOP_WEBHOOK_SECRET ?? '',
    authBaseUrl: 'https://api.prod.whoop.com/oauth/oauth2',
    apiBaseUrl: process.env.WHOOP_API_BASE_URL ?? 'https://api.prod.whoop.com/developer/v1',
  };
}

export function whoopConfigured(): boolean {
  const e = whoopEnv();
  return !!(e.clientId && e.clientSecret && e.redirectUri);
}
