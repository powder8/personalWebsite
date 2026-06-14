/* One-time: register (or inspect) the Strava push-subscription so new runs sync
 * in real time via /api/webhooks/strava. Strava allows ONE subscription per app.
 *
 * Run with your Strava app credentials (strava.com/settings/api):
 *   STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... \
 *     node --import tsx scripts/strava-subscribe.ts
 *
 * Optional env:
 *   CALLBACK_URL          (default https://throughline.badoo.net/api/webhooks/strava)
 *   STRAVA_VERIFY_TOKEN   (default "throughline" — MUST match the deployed app's value)
 *   DELETE=<id>           delete an existing subscription (e.g. to change callback)
 */
const clientId = process.env.STRAVA_CLIENT_ID;
const clientSecret = process.env.STRAVA_CLIENT_SECRET;
const callbackUrl = process.env.CALLBACK_URL || 'https://throughline.badoo.net/api/webhooks/strava';
const verifyToken = process.env.STRAVA_VERIFY_TOKEN || 'throughline';
const BASE = 'https://www.strava.com/api/v3/push_subscriptions';

(async () => {
  if (!clientId || !clientSecret) {
    console.error('Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET (from strava.com/settings/api).');
    process.exit(1);
  }
  const auth = `client_id=${clientId}&client_secret=${encodeURIComponent(clientSecret)}`;

  // Delete mode
  if (process.env.DELETE) {
    const r = await fetch(`${BASE}/${process.env.DELETE}?${auth}`, { method: 'DELETE' });
    console.log('Delete:', r.status, await r.text());
    process.exit(0);
  }

  // Inspect existing (Strava allows only one per app).
  const existing = await fetch(`${BASE}?${auth}`).then((r) => r.json());
  if (Array.isArray(existing) && existing.length) {
    console.log('A subscription already exists:', JSON.stringify(existing, null, 2));
    console.log('If its callback_url is wrong, delete it: DELETE=<id> node --import tsx scripts/strava-subscribe.ts');
    process.exit(0);
  }

  // Create — Strava will GET callback_url with hub.challenge to validate.
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    callback_url: callbackUrl,
    verify_token: verifyToken,
  });
  const res = await fetch(BASE, { method: 'POST', body });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('Create failed:', res.status, JSON.stringify(json));
    console.error('Common cause: callback_url not publicly reachable, or verify_token mismatch with the deployed app.');
    process.exit(1);
  }
  console.log('✅ Subscription created:', JSON.stringify(json, null, 2));
  console.log(`\nSet STRAVA_SUBSCRIPTION_ID="${json.id}" in Vercel (optional, for reference), and STRAVA_VERIFY_TOKEN="${verifyToken}" if not already set.`);
  process.exit(0);
})();
