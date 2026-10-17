/**
 * GET /api/cron/nudges — send due proactive nudges. Invoked by Vercel Cron a
 * couple of times a day (see vercel.json). Guarded by CRON_SECRET so it can't
 * be triggered by the public; Vercel Cron sends `Authorization: Bearer <secret>`
 * when CRON_SECRET is set in the project env.
 *
 * Pass ?dry=1 (with the secret) to preview who WOULD be nudged without sending.
 */
import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { runNudges } from '@/server/nudges';
import { runMonitor } from '@/server/monitor';
import { sealLegacyTokens } from '@/server/connectedAccountTokens';
import { getDb } from '@/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  // Fail CLOSED: this endpoint rewrites plans and emails athletes, so without a
  // configured secret it must not run on a real deployment. (Local dev with no
  // secret stays open so the cron can be exercised by hand.) Vercel Cron sends
  // `Authorization: Bearer <CRON_SECRET>` automatically once the var is set.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.VERCEL) {
      return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 });
    }
  } else {
    const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!safeEqual(provided, secret)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry') === '1';
  // Dry-run only: simulate a specific instant to preview who'd be nudged then.
  const atParam = url.searchParams.get('at');
  const now = dryRun && atParam ? new Date(atParam) : undefined;
  try {
    // Adapt the schedule to recovery/layoff signals BEFORE nudging, so any
    // message reflects the just-adjusted plan.
    // Housekeeping: encrypt any token stored before encryption existed.
    const tokensSealed = dryRun ? 0 : await sealLegacyTokens(await getDb()).catch(() => 0);
    const monitor = await runMonitor({ dryRun });
    const nudges = await runNudges({ dryRun, now });
    return NextResponse.json({ ok: true, dryRun, monitor, nudges, tokensSealed });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 500 });
  }
}

/** Constant-time string compare (hash first so lengths always match). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
