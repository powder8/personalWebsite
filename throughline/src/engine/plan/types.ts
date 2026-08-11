/**
 * Plan-engine types. Pure and DB-free (like the readiness engine). These are
 * RICHER than the DB's session_type enum on purpose — they mirror how the coach
 * actually thinks (maintenance, marathon, rep…) and are mapped down to the
 * schema at persistence time.
 *
 * Units are SI internally: distance in meters, pace in seconds per kilometre.
 * Display helpers convert to miles + min/mile (how the coach reads it).
 *
 * "Fidelity now, generalize later": the engine takes a TemplateSet and a
 * ZoneModel as inputs. The defaults encode the coach's model; swapping them
 * generalizes the engine without code changes.
 */

/** Named training intensities — the coach's taxonomy. */
export type ZoneKey =
  | 'recovery'
  | 'easy'
  | 'maintenance'
  | 'marathon'
  | 'threshold'
  | 'interval'
  | 'rep';

/** A run's role in the week (drives distribution + which zone it uses). */
export type RunType =
  | 'recovery'
  | 'easy'
  | 'maintenance'
  | 'long'
  | 'quality' // threshold/tempo/interval/rep workout (zone in the QualitySpec)
  | 'race'
  | 'rest'
  | 'cross_train';

export type TrainingPhase = 'base' | 'build' | 'peak' | 'taper';

/**
 * The sport a plan is built for. Running is the original, fully-implemented
 * discipline; cycling is being added behind a strategy seam (see strategy.ts).
 * Mirrors the `discipline` pgEnum on athletes/plans/planned_sessions.
 */
export type Discipline = 'run' | 'bike';

/** Pace band in seconds per km. `fast` <= `slow` (lower seconds = faster). */
export interface PaceRange {
  fastSecPerKm: number;
  slowSecPerKm: number;
}

export interface PaceZones {
  thresholdSecPerKm: number;
  zones: Record<ZoneKey, PaceRange>;
}

// --- cycling: power zones (the pace-zone analog for the bike discipline) ---

/**
 * Coggan 7-zone power taxonomy, plus the coach-added `sweetspot` sub-zone
 * (88–94% FTP) folded between tempo and threshold — the power-side twin of the
 * running `maintenance` sub-zone. `sweetspot` deliberately OVERLAPS tempo/
 * threshold: it is a training band, not part of a mutually exclusive tiling.
 */
export type PowerZoneKey =
  | 'recovery' // Coggan Z1 Active Recovery
  | 'endurance' // Coggan Z2 Endurance
  | 'tempo' // Coggan Z3 Tempo
  | 'sweetspot' // 88–94% FTP (Z3/Z4 straddle, coach-added)
  | 'threshold' // Coggan Z4 Lactate Threshold
  | 'vo2max' // Coggan Z5 VO2max
  | 'anaerobic' // Coggan Z6 Anaerobic Capacity
  | 'sprint'; // Coggan Z7 Neuromuscular Power

/** A power band in watts. `lo` <= `hi` (higher watts = harder). */
export interface PowerRange {
  loWatts: number;
  hiWatts: number;
}

/** A heart-rate band in bpm, used on the HR (no-power-meter) fallback path. */
export interface HrRange {
  loBpm: number;
  hiBpm: number;
}

/**
 * Cycling training zones — the power-side analog of `PaceZones`. Carries the
 * `kind: 'power'` discriminant so it can be told apart from pace zones in the
 * generalized `TrainingZones` union.
 *
 * Two derivations are represented behind one shape (`basis`):
 *   - `basis: 'ftp'`  → athlete has a power meter: `zones` are %FTP watt bands;
 *                       `hrZones` may be present as a SECONDARY cue if LTHR known.
 *   - `basis: 'lthr'` → no power meter: `zones` is null and `hrZones` (%LTHR bpm
 *                       bands) is the PRIMARY prescription. HR saturates above
 *                       threshold, so the top zones there are unreliable.
 */
export interface PowerZones {
  kind: 'power';
  basis: 'ftp' | 'lthr';
  /** Anchor FTP in watts; null on the HR-only fallback path. */
  ftpWatts: number | null;
  /** Lactate-threshold HR in bpm; present when the HR bands are populated. */
  lthrBpm: number | null;
  /** %FTP watt bands. Null when `basis: 'lthr'` (no power meter). */
  zones: Record<PowerZoneKey, PowerRange> | null;
  /** %LTHR bpm bands. Primary when `basis: 'lthr'`; secondary cue otherwise. */
  hrZones: Record<PowerZoneKey, HrRange> | null;
}

/**
 * The generalized training-zone type a `DisciplineStrategy` resolves: pace-based
 * for running or power-based for cycling. The running arm is the EXISTING
 * `PaceZones` shape, left untagged and byte-identical so every current consumer
 * and test is unaffected; the cycling arm is `PowerZones`, tagged `kind:'power'`.
 * Narrow with `isPowerZones()` / `isPaceZones()` from powerZonesLogic.ts.
 */
export type TrainingZones = PaceZones | PowerZones;

/** A structured segment within a quality session (e.g. "6×1k @ threshold"). */
export interface WorkoutSegment {
  role: 'warmup' | 'work' | 'recovery_jog' | 'cooldown';
  zone: ZoneKey;
  /** repeats × repMeters describes intervals; distanceMeters for continuous. */
  reps?: number;
  repMeters?: number;
  distanceMeters?: number;
  restSeconds?: number;
  note?: string;
}

/** One planned day produced by the engine (mapped to PlannedSession on save). */
export interface PlannedDay {
  day: string; // 'YYYY-MM-DD'
  dow: number; // 0=Mon … 6=Sun
  runType: RunType;
  zone: ZoneKey | null; // primary zone (null for rest)
  distanceMeters: number; // total incl. warmup/cooldown
  warmup?: string;
  cooldown?: string;
  segments?: WorkoutSegment[];
  description: string; // engine's structured intent (LLM phrases for athlete later)
  optionalStrides?: boolean;
  pinned: boolean;
}

export interface PlannedWeek {
  weekStart: string; // Monday 'YYYY-MM-DD'
  phase: TrainingPhase;
  cycle: number; // 1-based mesocycle index
  targetVolumeMeters: number;
  days: PlannedDay[];
  rationale: string; // the "Things to think about" note
}

// --- template model (the coach's microcycle, as config) ---

export interface QualitySpec {
  zone: ZoneKey;
  /** Fraction of the day's distance that is quality work (rest are wu/cd). */
  workFraction: number;
  segments?: Omit<WorkoutSegment, 'distanceMeters'>[]; // optional explicit reps
}

export interface DayTemplate {
  dow: number; // 0=Mon … 6=Sun
  runType: RunType;
  /** Relative share of the week's non-long volume (ignored for long/rest). */
  volumeWeight: number;
  quality?: QualitySpec;
  optionalStrides?: boolean;
}

export interface WeekTemplate {
  phase: TrainingPhase;
  /** Long run as a fraction of weekly volume (capped in generate). */
  longRunFraction: number;
  days: DayTemplate[];
}

export type TemplateSet = Record<TrainingPhase, WeekTemplate>;

/** Readiness band per day (from the readiness engine), keyed by 'YYYY-MM-DD'. */
export type ReadinessBandByDay = Record<string, 'easy' | 'normal' | 'go'>;
