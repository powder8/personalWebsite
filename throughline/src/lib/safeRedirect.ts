/**
 * The callback as a same-site path ("/me/…"), or undefined. Auth.js passes the
 * full URL of the page you were on, so a same-host absolute URL is reduced to
 * its path; any other host (or a protocol-relative "//evil") is dropped.
 */
export function safeCallbackPath(raw: string | undefined, host: string | null): string | undefined {
  if (!raw) return undefined;
  if (raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')) return raw;
  try {
    const u = new URL(raw);
    if ((u.protocol === 'https:' || u.protocol === 'http:') && host && u.host === host) return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    /* not a URL */
  }
  return undefined;
}
