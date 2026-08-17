/**
 * PURE anchor-update decision (no DB). Given the current fitness anchor and the
 * best DEMONSTRATED recent race effort, decide whether to re-anchor.
 *
 * Policy (the "leverage your best recent race" rule):
 *  - A demonstrated effort only counts if it's recent enough to still reflect
 *    current fitness (within `relevanceDays` of today). An old PR doesn't anchor.
 *  - An auto/unset anchor simply tracks the best recent effort (both directions),
 *    skipping a no-op rewrite when it's already there.
 *  - A human-set ('manual') anchor is respected — EXCEPT a self-coached
 *    (autonomous) athlete whose recent race is clearly faster than their stated
 *    number: real performance should win over a stale guess. We never auto-
 *    *downgrade* a human anchor (a single off day shouldn't lower your targets);
 *    the "these look fast" grounding prompt handles the optimistic case.
 */

export interface AnchorDecisionInput {
  currentVdot: number | null; // VDOT the current anchor implies
  anchorSource: 'manual' | 'auto' | null | undefined;
  autonomous: boolean; // self-coached athlete (no human coach)
  best: { vdot: number; day: string } | null; // best demonstrated race effort
  today: string; // YYYY-MM-DD
  relevanceDays: number; // how recent an effort must be to anchor
  upgradeDelta: number; // VDOT gap required to override a manual anchor
}

export interface AnchorDecision {
  set: boolean;
  reason: string;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function decideAnchorUpdate(i: AnchorDecisionInput): AnchorDecision {
  if (!i.best) return { set: false, reason: 'no recent demonstrated effort' };

  const ageDays = daysBetween(i.best.day, i.today);
  if (ageDays > i.relevanceDays) {
    return { set: false, reason: `best effort is ${ageDays}d old, past the ${i.relevanceDays}d relevance window` };
  }

  const manual = i.anchorSource === 'manual';
  if (manual) {
    if (i.autonomous && (i.currentVdot == null || i.best.vdot > i.currentVdot + i.upgradeDelta)) {
      return { set: true, reason: 'autonomous athlete: recent race clearly faster than the stated anchor' };
    }
    return { set: false, reason: 'respecting the human-set anchor' };
  }

  // Auto / unset: track the best recent demonstrated effort, but don't churn if
  // we're already anchored to essentially this fitness.
  if (i.currentVdot != null && Math.abs(i.currentVdot - i.best.vdot) < 0.5) {
    return { set: false, reason: 'already anchored to ~this fitness' };
  }
  return { set: true, reason: 'tracking best recent demonstrated effort' };
}
