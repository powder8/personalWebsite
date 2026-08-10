/**
 * Throughline plan engine (Phase 3) — pure, deterministic, DB-free.
 *
 * Pipeline: fitness → pace zones → periodize (backward from race) →
 * generate week from the coach's template → adapt to readiness/soreness/injury.
 *
 * Defaults encode the coach's model (COACH_TEMPLATE_SET, DEFAULT_ZONE_MODEL);
 * both are inputs, so swapping them generalizes the engine.
 */
export * from './types';
export * from './zones';
export * from './templates';
export * from './periodize';
export * from './generate';
export * from './adapt';
export * from './diff';
export * from './vdot';
export * from './gap';
export * from './bestEffort';
export * from './feasibility';
export * from './paceConfig';
export * from './raceWindows';
export * from './racePurpose';
export * from './guardrails';
export * from './directives';
export * from './strategy';

import type { Discipline, PaceZones, PlannedWeek, TemplateSet } from './types';
import type { GoalClass } from './raceWindows';
import { periodize, type PeriodizationInput } from './periodize';
import { generateWeek } from './generate';
import { COACH_TEMPLATE_SET } from './templates';
import { selectStrategy } from './strategy';

/**
 * Generate a full periodized plan (one PlannedWeek per week) from fitness +
 * race date. Adaptation is applied separately, per-week, as signals arrive.
 *
 * The sport-agnostic skeleton (periodization, load distribution) is shared;
 * the sport-specific quality prescription is selected via `discipline` (default
 * 'run', so existing behaviour is unchanged).
 */
export function generatePlan(
  input: PeriodizationInput & { goalClass?: GoalClass; discipline?: Discipline },
  zones: PaceZones,
  templates: TemplateSet = COACH_TEMPLATE_SET,
): PlannedWeek[] {
  const strategy = selectStrategy(input.discipline ?? 'run');
  return periodize(input).map((w) =>
    generateWeek(w, templates[w.phase], zones, '', input.goalClass, strategy),
  );
}
