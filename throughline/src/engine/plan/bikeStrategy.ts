/**
 * Cycling discipline strategy — STUB. Not yet implemented.
 *
 * This exists so the discipline seam is complete and type-checks end to end;
 * every method throws until the cycling agents build it. See strategy.ts for
 * the contract. What each method must eventually do for cycling:
 *
 *   - resolveFitnessAnchor : return the athlete's FTP (functional threshold
 *     power, watts) — the cycling analogue of VDOT — from config/history.
 *   - resolveZones         : derive power zones (Coggan Z1–Z7, watts) from FTP,
 *     the analogue of pace zones. NOTE the current `PaceZones`/`ZoneKey` types
 *     are pace/second-per-km shaped; cycling will need a power-shaped zone model
 *     (either a parallel type or a generalised one) — flag this for the seam.
 *   - buildQuality*        : prescribe power-based intervals (e.g. 4×8 min @ FTP,
 *     30/30s at VO2 power) with the same warm-up → work → cool-down structure.
 *   - assessGoalFeasibility: a power/CTL improvement model (watts or W/kg gain
 *     over the trainable weeks), replacing the running VDOT/Riegel model.
 */
import type { DisciplineStrategy } from './strategy';

const NOT_IMPLEMENTED = 'bike strategy not yet implemented';

export const bikeStrategy: DisciplineStrategy = {
  discipline: 'bike',

  resolveFitnessAnchor() {
    throw new Error(NOT_IMPLEMENTED);
  },

  resolveZones() {
    throw new Error(NOT_IMPLEMENTED);
  },

  buildQualitySegments() {
    throw new Error(NOT_IMPLEMENTED);
  },

  buildQualityDescription() {
    throw new Error(NOT_IMPLEMENTED);
  },

  assessGoalFeasibility() {
    throw new Error(NOT_IMPLEMENTED);
  },
};
