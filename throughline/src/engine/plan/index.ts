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
export * from './paceConfig';
export * from './raceWindows';

import type { PaceZones, PlannedWeek, TemplateSet } from './types';
import { periodize, type PeriodizationInput } from './periodize';
import { generateWeek } from './generate';
import { COACH_TEMPLATE_SET } from './templates';

/**
 * Generate a full periodized plan (one PlannedWeek per week) from fitness +
 * race date. Adaptation is applied separately, per-week, as signals arrive.
 */
export function generatePlan(
  input: PeriodizationInput,
  zones: PaceZones,
  templates: TemplateSet = COACH_TEMPLATE_SET,
): PlannedWeek[] {
  return periodize(input).map((w) => generateWeek(w, templates[w.phase], zones));
}
