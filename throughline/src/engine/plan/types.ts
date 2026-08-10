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
