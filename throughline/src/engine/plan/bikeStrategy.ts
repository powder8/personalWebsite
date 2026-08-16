/**
 * Cycling discipline strategy.
 *
 * Story 1 (this file) wires the two pieces the cycling engine needs first — the
 * FTP fitness anchor and the power/HR zones — through the discipline seam, the
 * exact power-side mirror of `runStrategy` (VDOT + pace zones). The remaining
 * methods stay throwing stubs until their stories land:
 *
 *   - resolveFitnessAnchor : DONE (Story 1) — FTP (watts) from powerConfig.
 *   - resolveZones         : DONE (Story 1) — %FTP power zones, or %LTHR HR zones
 *                            with no power meter (powerZonesLogic.ts / ftpLogic.ts).
 *   - buildQuality*        : DONE (Story 4) — duration×%FTP interval prescription
 *                            (bikeWorkoutsLogic.ts).
 *   - assessGoalFeasibility: STUB (Story 6) — an FTP/CTL improvement model.
 *
 * The pure logic lives in ftpLogic.ts (anchor), powerZonesLogic.ts (zones), and
 * bikeWorkoutsLogic.ts (prescription); this file is just the wiring that puts
 * them behind the seam — same as runStrategy delegates to paceConfig/vdot/workouts.
 */
import type { DisciplineStrategy } from './strategy';
import type { AthletePowerConfig, GlobalPowerModel } from './ftpLogic';
import type { PowerZoneKey, TrainingZones } from './types';
import { resolveFtp, resolvePowerZones } from './ftpLogic';
import { isPowerZones } from './powerZonesLogic';
import { buildBikeQualitySegments, buildBikeQualityDescription } from './bikeWorkoutsLogic';

const NOT_IMPLEMENTED = 'bike strategy not yet implemented';

/**
 * Narrow the generalized seam to the power-shaped path the cycling library
 * speaks. The seam's volume scalars are MINUTES on the bike (duration-at-power),
 * versus miles on the run — see the `DisciplineStrategy` doc.
 */
function asPowerZones(zones: TrainingZones) {
  if (!isPowerZones(zones)) {
    throw new Error('bikeStrategy: expected power zones on the cycling discipline');
  }
  return zones;
}

export const bikeStrategy: DisciplineStrategy = {
  discipline: 'bike',

  resolveFitnessAnchor(config) {
    return resolveFtp(config as AthletePowerConfig);
  },

  resolveZones(config, global) {
    return resolvePowerZones(config as AthletePowerConfig, global as GlobalPowerModel | undefined);
  },

  buildQualitySegments(dayMinutes, zone, zones, workMinutes, wuCd, seed) {
    return buildBikeQualitySegments(dayMinutes, zone as PowerZoneKey, asPowerZones(zones), workMinutes, wuCd, seed);
  },

  buildQualityDescription(dayMinutes, zone, zones, workMinutes, wuCd, seed) {
    return buildBikeQualityDescription(dayMinutes, zone as PowerZoneKey, asPowerZones(zones), workMinutes, wuCd, seed);
  },

  assessGoalFeasibility() {
    // Bike feasibility runs through the multi-sport aggregate, not this seam:
    // the run-shaped GoalFeasibilityInput (VDOT + distance) can't carry rider
    // mass / race IF / course, which the FTP→time projection needs. See
    // triFeasibilityLogic.ts `assessTriFeasibility` (fills the FTP-gain curve).
    throw new Error(`${NOT_IMPLEMENTED}: use assessTriFeasibility (triFeasibilityLogic.ts)`);
  },
};
