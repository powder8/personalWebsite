import 'server-only';
/**
 * Tools the training chat can call to ACT on an athlete's plan — not just talk.
 * Validation + mapping is pure (chatToolPlan.ts); here we just perform the DB
 * mutation via existing, coach-reviewable server actions (directives / anchor),
 * so athlete- or coach-initiated changes flow through the same engine inputs the
 * coach already sees. Every change is reversible.
 */
import type { DB } from '@/db';
import { createDirective } from '@/server/directives';
import { setAnchor } from '@/server/anchor';
import { planToolAction } from '@/server/chatToolPlan';

export { CHAT_TOOLS } from '@/server/chatToolPlan';

export interface ChatActor {
  role: 'coach' | 'athlete';
  athleteId: string;
  firstName: string;
  today: string; // YYYY-MM-DD, for resolving relative dates
}

export interface ActionTaken {
  tool: string;
  summary: string;
  ok: boolean;
}

/** Execute one tool call. Returns a human-readable summary + ok flag (never throws). */
export async function executeChatTool(
  db: DB,
  actor: ChatActor,
  name: string,
  input: Record<string, unknown>,
): Promise<{ summary: string; ok: boolean }> {
  const plan = planToolAction(name, input);
  if ('error' in plan) return { ok: false, summary: plan.error };
  try {
    if (plan.type === 'directive') {
      await createDirective(db, actor.athleteId, plan.directive);
      return { ok: true, summary: plan.summary };
    }
    // anchor
    const r = await setAnchor(db, actor.athleteId, plan.anchor, { today: actor.today, source: 'manual' });
    return { ok: true, summary: `${plan.describe} → VDOT ${r.vdot}. ${r.updatedSessions} upcoming sessions retuned.` };
  } catch (e) {
    return { ok: false, summary: e instanceof Error ? e.message : 'Action failed.' };
  }
}
