/**
 * Directive persistence (windowed adjustments + athlete availability).
 *
 * Stored in the existing `directives` table. We keep `kind = 'other'` and carry
 * the structured adjustment in `params` ({ type, deltaSecPerMile?, factor? }) so
 * no enum migration is needed; the engine reads params.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { directives } from '@/db/schema';
import type { ActiveDirective, AdjustmentType } from '@/engine/plan';

export interface NewDirective {
  type: AdjustmentType;
  from: string; // YYYY-MM-DD
  to?: string | null; // null = ongoing
  deltaSecPerMile?: number;
  factor?: number;
  label?: string;
}

export async function createDirective(db: DB, athleteId: string, d: NewDirective): Promise<void> {
  await db.insert(directives).values({
    athleteId,
    kind: 'other',
    params: { type: d.type, deltaSecPerMile: d.deltaSecPerMile, factor: d.factor },
    effectiveFrom: d.from,
    effectiveTo: d.to ?? null,
    sourceText: d.label ?? null,
    active: true,
  });
}

export async function deactivateDirective(db: DB, id: string): Promise<void> {
  await db.update(directives).set({ active: false }).where(eq(directives.id, id));
}

export interface DirectiveRow extends ActiveDirective {
  id: string;
}

/** All active directives for an athlete, normalized for the engine + UI. */
export async function listActiveDirectives(db: DB, athleteId: string): Promise<DirectiveRow[]> {
  const rows = await db
    .select()
    .from(directives)
    .where(and(eq(directives.athleteId, athleteId), eq(directives.active, true)))
    .orderBy(desc(directives.effectiveFrom));
  return rows.map((r) => {
    const p = (r.params as { type?: AdjustmentType; deltaSecPerMile?: number; factor?: number } | null) ?? {};
    return {
      id: r.id,
      type: (p.type ?? 'pace_adjust') as AdjustmentType,
      from: r.effectiveFrom,
      to: r.effectiveTo ?? null,
      deltaSecPerMile: p.deltaSecPerMile,
      factor: p.factor,
      label: r.sourceText ?? undefined,
    };
  });
}
