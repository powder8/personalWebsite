/**
 * Swimming discipline strategy.
 *
 * The swim leg wires the pieces the swim engine needs through the discipline
 * seam, the exact swim-side mirror of `bikeStrategy` (FTP + power zones) and
 * `runStrategy` (VDOT + pace zones):
 *
 *   - resolveFitnessAnchor : CSS (m/s) from swimConfig (cssLogic.ts).
 *   - resolveZones         : CSS-relative sec/100 m swim zones (swimZonesLogic.ts /
 *                            cssLogic.ts). No HR fallback (swim HR is unreliable).
 *   - buildQuality*        : CSS-relative interval sets + drills (swimWorkoutsLogic.ts).
 *   - assessGoalFeasibility: STUB — a CSS-improvement / swim-volume model, later.
 *
 * The pure logic lives in cssLogic.ts (anchor), swimZonesLogic.ts (zones), and
 * swimWorkoutsLogic.ts (prescription); this file is just the wiring that puts
 * them behind the seam — same as runStrategy/bikeStrategy delegate to theirs.
 */
import type { DisciplineStrategy } from './strategy';
import type { AthleteSwimConfig, GlobalSwimModel } from './cssLogic';
import type { SwimZoneKey, TrainingZones } from './types';
import { resolveCss, resolveSwimZones } from './cssLogic';
import { isSwimZones } from './swimZonesLogic';
import { buildSwimQualitySegments, buildSwimQualityDescription } from './swimWorkoutsLogic';

const NOT_IMPLEMENTED = 'swim strategy not yet implemented';

/**
 * Narrow the generalized seam to the swim-shaped path the swim library speaks.
 * The seam's volume scalars are METRES for swimming (distance-at-pace), versus
 * miles on the run and minutes on the bike — see the `DisciplineStrategy` doc.
 */
function asSwimZones(zones: TrainingZones) {
  if (!isSwimZones(zones)) {
    throw new Error('swimStrategy: expected swim zones on the swimming discipline');
  }
  return zones;
}

export const swimStrategy: DisciplineStrategy = {
  discipline: 'swim',

  resolveFitnessAnchor(config) {
    return resolveCss(config as AthleteSwimConfig);
  },

  resolveZones(config, global) {
    return resolveSwimZones(config as AthleteSwimConfig, global as GlobalSwimModel | undefined);
  },

  buildQualitySegments(dayMeters, zone, zones, workMeters, wuCd, seed) {
    return buildSwimQualitySegments(dayMeters, zone as SwimZoneKey, asSwimZones(zones), workMeters, wuCd, seed);
  },

  buildQualityDescription(dayMeters, zone, zones, workMeters, wuCd, seed) {
    return buildSwimQualityDescription(dayMeters, zone as SwimZoneKey, asSwimZones(zones), workMeters, wuCd, seed);
  },

  assessGoalFeasibility() {
    // Swim feasibility runs through the multi-sport aggregate, not this seam:
    // the run-shaped GoalFeasibilityInput can't carry the swim race distance /
    // CSS-fraction the CSS→time projection needs. See triFeasibilityLogic.ts
    // `assessTriFeasibility` (fills the CSS-gain curve).
    throw new Error(`${NOT_IMPLEMENTED}: use assessTriFeasibility (triFeasibilityLogic.ts)`);
  },
};
