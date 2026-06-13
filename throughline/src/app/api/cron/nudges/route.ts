/**
 * GET /api/cron/nudges — send due proactive nudges. Invoked by Vercel Cron a
 * couple of times a day (see vercel.json). Guarded by CRON_SECRET so it can't
 * be triggered by the public; Vercel Cron sends `Authorization: Bearer <secret>`
 * when CRON_SECRET is set in the project env.
 *
 * Pass ?dry=1 (with the secret) to preview who WOULD be nudged without sending.
 */
import { NextResponse } from 'next/server';
import { runNudges } from '@/server/nudges';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    const url = new URL(req.url);
    const provided = auth?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('secret');
    if (provided !== secret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry') === '1';
  // Dry-run only: simulate a specific instant to preview who'd be nudged then.
  const atParam = url.searchParams.get('at');
  const now = dryRun && atParam ? new Date(atParam) : undefined;
  try {
    const result = await runNudges({ dryRun, now });
    return NextResponse.json({ ok: true, dryRun, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed.' }, { status: 500 });
  }
}
