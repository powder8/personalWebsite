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
 * discipline; cycling and swimming are added behind a strategy seam (see
 * strategy.ts). Mirrors the transfer model's `Discipline` (transferLogic.ts) and
 * the `discipline` dimension on athletes/plans/planned_sessions.
 */
export type Discipline = 'run' | 'bike' | 'swim';

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
  | 'sweetspot' // 88-94% FTP (Z3/Z4 straddle, coach-added)
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

// --- swimming: CSS-relative pace zones (the pace/power-zone analog for swim) ---

/**
 * Swim training-intensity taxonomy — CSS-relative sec/100 m bands (Swim Smooth /
 * Friel). `threshold` straddles CSS (the anchor); faster zones sit below CSS
 * pace, easier zones above it. There are fewer, coarser bands than the run/bike
 * taxonomies because swim pace resolution in the pool is coarser.
 */
export type SwimZoneKey =
  | 'recovery' // very easy, technique/warm-up (CSS + 10-20 s/100)
  | 'aerobic' // endurance / long-set base (CSS + 4-10 s/100)
  | 'threshold' // at/around CSS, the anchor band (CSS ± 2 s/100)
  | 'vo2max' // above CSS, short-course sharpening (CSS − 2-6 s/100)
  | 'sprint'; // 25/50 speed work, well above CSS (CSS − 6 s/100 and faster)

/**
 * A swim pace band in sec/100 m. `fast` <= `slow` (fewer seconds = faster). The
 * swim-side analog of `PaceRange` (sec/km) and `PowerRange` (watts).
 */
export interface SwimRange {
  fastSecPer100: number;
  slowSecPer100: number;
}

/**
 * Swim training zones — the swim-side analog of `PaceZones` / `PowerZones`.
 * Carries the `kind: 'swim'` discriminant so it can be told apart in the
 * generalized `TrainingZones` union. Bands are CSS-relative sec/100 m; CSS is
 * stored as m/s internally (`cssMetersPerSec`), with `cssPaceSecPer100` its
 * display form (`100 / cssMetersPerSec`). No HR fallback (swim HR is unreliable).
 */
export interface SwimZones {
  kind: 'swim';
  cssMetersPerSec: number;
  cssPaceSecPer100: number;
  zones: Record<SwimZoneKey, SwimRange>;
}

/**
 * The generalized training-zone type a `DisciplineStrategy` resolves: pace-based
 * for running, power-based for cycling, or CSS-relative pace for swimming. The
 * running arm is the EXISTING `PaceZones` shape, left untagged and byte-identical
 * so every current consumer and test is unaffected; the cycling arm is
 * `PowerZones` (`kind:'power'`) and the swim arm is `SwimZones` (`kind:'swim'`).
 * Narrow with `isPowerZones()` / `isPaceZones()` from powerZonesLogic.ts and
 * `isSwimZones()` from swimZonesLogic.ts.
 */
export type TrainingZones = PaceZones | PowerZones | SwimZones;

/**
 * A structured segment within a quality session (e.g. "6×1k @ threshold" for
 * running, "4×8min @ threshold" for cycling).
 *
 * The type is discipline-generalized: the RUNNING fields (distance-at-pace) are
 * unchanged, and the CYCLING fields (duration-at-power) are added alongside as
 * optional. A given segment uses one family or the other — running sets
 * `repMeters`/`distanceMeters`, cycling sets `repSeconds`/`durationSeconds` +
 * watt targets — so running output stays byte-identical (it never sets the new
 * optional keys, and the widened `role`/`zone` unions don't change its values).
 */
export interface WorkoutSegment {
  role: 'warmup' | 'work' | 'recovery_jog' | 'recovery_spin' | 'cooldown';
  zone: ZoneKey | PowerZoneKey | SwimZoneKey;
  reps?: number;
  // --- running: distance-at-pace ---
  /** repeats × repMeters describes running intervals; distanceMeters continuous. */
  repMeters?: number;
  distanceMeters?: number;
  // --- cycling: duration-at-power ---
  /** repeats × repSeconds describes cycling intervals; durationSeconds continuous. */
  repSeconds?: number;
  durationSeconds?: number;
  /** Power target for the block, filled from the athlete's %FTP zones at build. */
  targetLoWatts?: number;
  targetHiWatts?: number;
  // --- swimming: distance-at-CSS-pace (metres; reuses reps/repMeters/distanceMeters) ---
  /** Swim pace target (sec/100 m), filled from the athlete's CSS zones at build. */
  targetFastSecPer100?: number;
  targetSlowSecPer100?: number;
  restSeconds?: number;
  note?: string;
}

/** One planned day produced by the engine (mapped to PlannedSession on save). */
export interface PlannedDay {
  day: string; // 'YYYY-MM-DD'
  dow: number; // 0=Mon ... 6=Sun
  runType: RunType;
  /**
   * Primary zone (null for rest). Pace-shaped (`ZoneKey`) on the run discipline,
   * power-shaped (`PowerZoneKey`) on the bike, CSS-relative (`SwimZoneKey`) on the
   * swim — widened additively so the running arm's values are unchanged.
   */
  zone: ZoneKey | PowerZoneKey | SwimZoneKey | null;
  distanceMeters: number; // total incl. warmup/cooldown (running currency; 0 on the bike)
  // --- cycling: duration-at-power prescription (the distance/pace analog) ---
  /** Total session duration incl. warm-up/cool-down (bike currency). */
  durationSeconds?: number;
  /** The day's planned TSS-equivalent load (bike; the miles analog on the run). */
  targetLoadTss?: number;
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
  targetVolumeMeters: number; // running weekly-volume currency (0 on the bike)
  /** Weekly TSS-equivalent target — the discipline-generic load (bike currency). */
  targetLoadTss?: number;
  days: PlannedDay[];
  rationale: string; // the "Things to think about" note
}

// --- template model (the coach's microcycle, as config) ---

export interface QualitySpec {
  /** Pace zone on the run, power zone on the bike, CSS-relative zone on the swim (widened additively). */
  zone: ZoneKey | PowerZoneKey | SwimZoneKey;
  /** Fraction of the day's distance that is quality work (rest are wu/cd). */
  workFraction: number;
  /**
   * Swim only: this "quality" day is a first-class TECHNIQUE/drill session
   * (prescribed by frequency, not load — swim-foundation-spec §5). The swim
   * generator routes these through `buildSwimTechniqueSegments` rather than the
   * CSS-interval builder. Ignored on the run/bike arms (they never set it).
   */
  technique?: boolean;
  segments?: Omit<WorkoutSegment, 'distanceMeters'>[]; // optional explicit reps
}

export interface DayTemplate {
  dow: number; // 0=Mon ... 6=Sun
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
