/**
 * Parse a Strava route link → its numeric route id. SECURITY-CRITICAL: the only
 * thing we ever do with a user-pasted URL is extract a numeric id from a
 * strava.com/routes/<id> link; the server then builds its OWN Strava API URL
 * from that id. We never fetch the pasted URL itself, so this can't be turned
 * into an SSRF (any non-Strava host, or a non-route path, returns null).
 */
export function parseStravaRouteId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // A bare numeric id is fine too.
  if (/^\d{4,}$/.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host !== 'strava.com') return null;
  const m = /^\/routes\/(\d{4,})(?:$|[/?#])/.exec(url.pathname + (url.pathname.endsWith('/') ? '' : ''));
  return m ? m[1] : null;
}
