/**
 * Directive persistence (windowed adjustments + athlete availability).
 *
 * Stored in the existing `directives` table. We keep `kind = 'other'` and carry
 * the structured adjustment in `params` ({ type, deltaSecPerMile?, factor?,
 * source?, category?, status? }) so no enum migration is needed; the engine
 * reads params.
 *
 * `active=true` gates whether a directive is applied to the plan (see
 * applyDirectives). Proactive-monitor proposals in ASSISTED mode are stored
 * with active=false + status='proposed' so they DON'T change the plan until a
 * coach approves (flips active=true). Autonomous adaptations are active=true.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { directives } from '@/db/schema';
import type { ActiveDirective, AdjustmentType } from '@/engine/plan';

export type DirectiveSource = 'coach' | 'auto' | 'athlete';
/** Why an auto directive exists — lets the monitor regenerate its own idempotently. */
export type DirectiveCategory = 'low_recovery' | 'missed_days' | 'injury';
export type DirectiveStatus = 'active' | 'proposed' | 'declined' | 'cleared';

interface DirectiveParams {
  type?: AdjustmentType;
  deltaSecPerMile?: number;
  factor?: number;
  source?: DirectiveSource;
  category?: DirectiveCategory;
  status?: DirectiveStatus;
}

export interface NewDirective {
  type: AdjustmentType;
  from: string; // YYYY-MM-DD
  to?: string | null; // null = ongoing
  deltaSecPerMile?: number;
  factor?: number;
  label?: string;
  source?: DirectiveSource; // default 'coach'
  category?: DirectiveCategory;
  /** Assisted-mode proposal: stored inactive until a coach approves. */
  proposed?: boolean;
}

export async function createDirective(db: DB, athleteId: string, d: NewDirective): Promise<string> {
  const status: DirectiveStatus = d.proposed ? 'proposed' : 'active';
  const params: DirectiveParams = {
    type: d.type,
    deltaSecPerMile: d.deltaSecPerMile,
    factor: d.factor,
    source: d.source ?? 'coach',
    category: d.category,
    status,
  };
  const [row] = await db
    .insert(directives)
    .values({
      athleteId,
      kind: 'other',
      params,
      effectiveFrom: d.from,
      effectiveTo: d.to ?? null,
      sourceText: d.label ?? null,
      active: !d.proposed,
    })
    .returning({ id: directives.id });
  return row.id;
}

export async function deactivateDirective(db: DB, id: string): Promise<void> {
  await db.update(directives).set({ active: false }).where(eq(directives.id, id));
}

/** The athlete a directive belongs to (for authz scoping), or null if missing. */
export async function getDirectiveAthleteId(db: DB, id: string): Promise<string | null> {
  const [row] = await db.select({ athleteId: directives.athleteId }).from(directives).where(eq(directives.id, id)).limit(1);
  return row?.athleteId ?? null;
}

async function setStatus(db: DB, id: string, status: DirectiveStatus, active: boolean): Promise<void> {
  const [row] = await db.select({ params: directives.params }).from(directives).where(eq(directives.id, id)).limit(1);
  const params = { ...((row?.params as DirectiveParams | null) ?? {}), status };
  await db.update(directives).set({ params, active }).where(eq(directives.id, id));
}

/** Coach approves a proposed adaptation → it applies to the plan. */
export function approveDirective(db: DB, id: string): Promise<void> {
  return setStatus(db, id, 'active', true);
}
/** Coach declines a proposed adaptation → it stays off the plan. */
export function declineDirective(db: DB, id: string): Promise<void> {
  return setStatus(db, id, 'declined', false);
}

export interface DirectiveRow extends ActiveDirective {
  id: string;
  source?: DirectiveSource;
  category?: DirectiveCategory;
}

function toRow(r: {
  id: string;
  params: unknown;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceText: string | null;
}): DirectiveRow {
  const p = (r.params as DirectiveParams | null) ?? {};
  return {
    id: r.id,
    type: (p.type ?? 'pace_adjust') as AdjustmentType,
    from: r.effectiveFrom,
    to: r.effectiveTo ?? null,
    deltaSecPerMile: p.deltaSecPerMile,
    factor: p.factor,
    label: r.sourceText ?? undefined,
    source: p.source,
    category: p.category,
  };
}

/** All ACTIVE directives for an athlete, normalized for the engine + UI. */
export async function listActiveDirectives(db: DB, athleteId: string): Promise<DirectiveRow[]> {
  const rows = await db
    .select()
    .from(directives)
    .where(and(eq(directives.athleteId, athleteId), eq(directives.active, true)))
    .orderBy(desc(directives.effectiveFrom));
  return rows.map(toRow);
}

/** Deactivate the monitor's own prior directives for a category (idempotent regen). */
export async function clearAutoDirectives(db: DB, athleteId: string, category: DirectiveCategory): Promise<void> {
  const rows = await db.select().from(directives).where(eq(directives.athleteId, athleteId));
  const mine = rows.filter((r) => {
    const p = (r.params as DirectiveParams | null) ?? {};
    return p.source === 'auto' && p.category === category && (r.active || p.status === 'proposed');
  });
  for (const r of mine) {
    const params = { ...((r.params as DirectiveParams | null) ?? {}), status: 'cleared' as DirectiveStatus };
    await db.update(directives).set({ active: false, params }).where(eq(directives.id, r.id));
  }
}

/** Pending auto proposals awaiting coach approval (assisted mode). */
export interface ProposedDirective extends DirectiveRow {
  athleteId: string;
}
export async function listProposedDirectives(db: DB, athleteId?: string): Promise<ProposedDirective[]> {
  const rows = athleteId
    ? await db.select().from(directives).where(and(eq(directives.athleteId, athleteId), eq(directives.active, false)))
    : await db.select().from(directives).where(eq(directives.active, false));
  return rows
    .filter((r) => (r.params as DirectiveParams | null)?.status === 'proposed')
    .map((r) => ({ ...toRow(r), athleteId: r.athleteId }));
}
