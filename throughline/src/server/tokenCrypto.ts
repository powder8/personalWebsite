/**
 * Encryption at rest for third-party OAuth tokens (Strava, Whoop, Garmin).
 * AES-256-GCM with a random 96-bit IV per value; the auth tag makes tampering
 * detectable. Stored form: "enc:v1:<base64url(iv | tag | ciphertext)>".
 *
 * Key: TOKEN_ENCRYPTION_KEY (32 bytes, base64 or hex). Without it, local dev
 * derives one from AUTH_SECRET (or a fixed dev string); a deployed build with
 * neither refuses to seal rather than store plaintext.
 *
 * Values written before encryption existed are plaintext. openToken() reads
 * them as-is, and callers re-seal them on the next read (see isSealed).
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';

function loadKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (raw) {
    const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64).');
    return key;
  }
  const fallback = process.env.AUTH_SECRET || (process.env.VERCEL ? null : 'throughline-dev-token-key');
  if (!fallback) throw new Error('TOKEN_ENCRYPTION_KEY is not configured.');
  return Buffer.from(hkdfSync('sha256', fallback, 'throughline', 'oauth-token-encryption', 32));
}

let cached: { fingerprint: string; key: Buffer } | null = null;
function key(): Buffer {
  // Re-derive if the env changed (tests swap keys); cheap fingerprint check.
  const fp = createHash('sha256').update(`${process.env.TOKEN_ENCRYPTION_KEY ?? ''}|${process.env.AUTH_SECRET ?? ''}`).digest('hex');
  if (!cached || cached.fingerprint !== fp) cached = { fingerprint: fp, key: loadKey() };
  return cached.key;
}

export function isSealed(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** Encrypt a token for storage. Null stays null; an already-sealed value is left alone. */
export function sealToken(plain: string | null | undefined): string | null {
  if (plain == null || plain === '') return null;
  if (isSealed(plain)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}

/** Decrypt a stored token. Legacy plaintext passes through unchanged. */
export function openToken(stored: string | null | undefined): string | null {
  if (stored == null || stored === '') return null;
  if (!isSealed(stored)) return stored;
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64url');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
