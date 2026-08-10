/**
 * Running discipline strategy — the original, fully-implemented sport.
 *
 * This is deliberately thin: it does NOT reimplement anything. It selects the
 * existing, battle-tested running modules and presents them through the
 * `DisciplineStrategy` seam, so the engine can pick a sport without any of the
 * running behaviour changing. The running logic still lives in its modules:
 *
 *   - fitness anchor + zones : paceConfig.ts (resolvePaceZones), vdot.ts
 *   - quality prescription   : workouts.ts (buildQualitySegments/Description)
 *   - feasibility guardrails : feasibility.ts (assessGoalFeasibility)
 *
 * Those modules ARE the running implementation; this file is the wiring that
 * puts them behind the discipline seam.
 */
import type { DisciplineStrategy } from './strategy';
import type { AthletePaceConfig, GlobalPaceModel } from './paceConfig';
import { resolvePaceZones, vdotFromThreshold } from './paceConfig';
import { vdotFromRace } from './vdot';
import { buildQualitySegments, buildQualityDescription } from './workouts';
import { assessGoalFeasibility } from './feasibility';

/**
 * VDOT taken DIRECTLY from the fitness anchor (explicit VDOT → race → threshold),
 * never re-derived from the resolved training zones (those carry per-athlete
 * tweaks that must not move the fitness number). Mirrors the anchor precedence
 * in db/paceConfig.ts#getAthleteVdot, minus the DB/intake fallback.
 */
function resolveVdot(config: AthletePaceConfig): number | null {
  if (config.vdot != null) return config.vdot;
  if (config.race) return vdotFromRace(config.race);
  if (config.thresholdSecPerKm != null) return vdotFromThreshold(config.thresholdSecPerKm);
  return null;
}

export const runStrategy: DisciplineStrategy = {
  discipline: 'run',

  resolveFitnessAnchor: resolveVdot,

  resolveZones(config: AthletePaceConfig, global?: GlobalPaceModel) {
    return resolvePaceZones(config, global);
  },

  buildQualitySegments,
  buildQualityDescription,

  assessGoalFeasibility,
};
