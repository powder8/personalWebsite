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
export * from './bikeGenerate';
export * from './bikeTemplates';
export * from './adapt';
export * from './diff';
export * from './vdot';
export * from './powerZonesLogic';
export * from './ftpLogic';
export * from './bikeWorkoutsLogic';
export * from './swimZonesLogic';
export * from './cssLogic';
export * from './swimWorkoutsLogic';
export * from './gap';
export * from './bestEffort';
export * from './feasibility';
export * from './paceConfig';
export * from './raceWindows';
export * from './racePurpose';
export * from './guardrails';
export * from './directives';
export * from './strategy';

import type { Discipline, TrainingZones, PlannedWeek, TemplateSet } from './types';
import type { GoalClass } from './raceWindows';
import { periodize, type PeriodizationInput } from './periodize';
import { generateWeek } from './generate';
import { COACH_TEMPLATE_SET } from './templates';
import { COACH_BIKE_TEMPLATE_SET } from './bikeTemplates';
import { selectStrategy } from './strategy';

/**
 * Generate a full periodized plan (one PlannedWeek per week) from fitness +
 * event date. Adaptation is applied separately, per-week, as signals arrive.
 *
 * The sport-agnostic skeleton (periodization, load distribution) is shared; the
 * sport-specific pieces are selected via `discipline` (default 'run', so
 * existing behaviour is byte-identical):
 *   - RUN  → pace zones, distributes MILES, distance @ pace, `COACH_TEMPLATE_SET`.
 *   - BIKE → power zones, distributes TSS, duration @ power, `COACH_BIKE_TEMPLATE_SET`.
 *
 * `zones` must match the discipline (`PaceZones` for run, `PowerZones` for bike);
 * `startVolumeMiles`/`peakVolumeMiles` are read as weekly TSS on the bike.
 */
export function generatePlan(
  input: PeriodizationInput & { goalClass?: GoalClass; discipline?: Discipline },
  zones: TrainingZones,
  templates?: TemplateSet,
): PlannedWeek[] {
  const discipline = input.discipline ?? 'run';
  const strategy = selectStrategy(discipline);
  const bike = discipline === 'bike';
  const templateSet = templates ?? (bike ? COACH_BIKE_TEMPLATE_SET : COACH_TEMPLATE_SET);
  // Cycling periodizes on weekly TSS, running on miles→meters (spec §4.3).
  const periodized = periodize({ ...input, volumeUnit: bike ? 'tss' : 'meters' });
  return periodized.map((w) =>
    generateWeek(w, templateSet[w.phase], zones, '', input.goalClass, strategy),
  );
}
