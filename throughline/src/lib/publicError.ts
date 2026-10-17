/**
 * The message an API route may show a user for a caught error. Our own thrown
 * errors are written for people ("Enter your FTP in watts") and pass through;
 * anything that looks internal (database errors with SQL text, network
 * failures, provider HTTP codes, runtime TypeErrors, config names) becomes the
 * route's generic fallback and is logged server-side instead.
 */
const INTERNAL = [
  /failed query/i,
  /relation "|column "|constraint "/i,
  /violates|duplicate key|syntax error|deadlock/i,
  /\bECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket|fetch failed/i,
  /HTTP \d{3}/,
  /cannot read prop|is not a function|is not defined|undefined|unexpected token/i,
  /DATABASE_URL|AUTH_SECRET|TOKEN_ENCRYPTION_KEY|API_KEY|CLIENT_SECRET/,
];
const DB_ERROR_NAMES = new Set(['NeonDbError', 'DatabaseError', 'DrizzleQueryError', 'PostgresError', 'TypeError', 'ReferenceError', 'SyntaxError']);

export function isPublicMessage(e: unknown): e is Error {
  if (!(e instanceof Error)) return false;
  if (DB_ERROR_NAMES.has(e.name)) return false;
  const code = (e as { code?: unknown }).code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return false; // Postgres SQLSTATE
  if (!e.message || e.message.length > 200) return false;
  return !INTERNAL.some((re) => re.test(e.message));
}

export function publicErrorMessage(e: unknown, fallback: string): string {
  if (isPublicMessage(e)) return e.message;
  console.error('[api-error]', e instanceof Error ? `${e.name}: ${e.message}` : e);
  return fallback;
}
