/**
 * Cycling discipline strategy.
 *
 * Story 1 (this file) wires the two pieces the cycling engine needs first — the
 * FTP fitness anchor and the power/HR zones — through the discipline seam, the
 * exact power-side mirror of `runStrategy` (VDOT + pace zones). The remaining
 * methods stay throwing stubs until their stories land:
 *
 *   - resolveFitnessAnchor : DONE — FTP (watts) from powerConfig (ftpLogic.ts).
 *   - resolveZones         : DONE — %FTP power zones, or %LTHR HR zones with no
 *                            power meter (powerZonesLogic.ts / ftpLogic.ts).
 *   - buildQuality*        : STUB (Story 4) — power-based interval prescription.
 *   - assessGoalFeasibility: STUB (Story 6) — an FTP/CTL improvement model.
 *
 * The pure logic lives in ftpLogic.ts (anchor) and powerZonesLogic.ts (zones);
 * this file is just the wiring that puts them behind the seam — same as
 * runStrategy delegates to paceConfig/vdot/workouts.
 */
import type { DisciplineStrategy } from './strategy';
import type { AthletePowerConfig, GlobalPowerModel } from './ftpLogic';
import { resolveFtp, resolvePowerZones } from './ftpLogic';

const NOT_IMPLEMENTED = 'bike strategy not yet implemented';

export const bikeStrategy: DisciplineStrategy = {
  discipline: 'bike',

  resolveFitnessAnchor(config) {
    return resolveFtp(config as AthletePowerConfig);
  },

  resolveZones(config, global) {
    return resolvePowerZones(config as AthletePowerConfig, global as GlobalPowerModel | undefined);
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
