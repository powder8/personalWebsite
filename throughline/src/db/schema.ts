/**
 * Throughline V1 — Phase 1 data foundation.
 *
 * Architecture principles encoded here:
 *  1. RawEvent is APPEND-ONLY. Every inbound byte (webhook, backfill, upload)
 *     lands here first and is never mutated. Everything else is derived and
 *     re-derivable from it.
 *  2. Override / Directive capture every coach intervention as labeled data.
 *     Interventions edit ENGINE INPUTS (state, constraints, directives, pins),
 *     not engine outputs — so replanning stays coherent.
 *
 * Provider-specific concerns (Garmin) are kept out of the schema: `provider`
 * is an enum and raw payloads are jsonb, so Whoop/Oura/Apple can be added later
 * without a migration.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const providerEnum = pgEnum('provider', ['garmin', 'strava', 'manual', 'whoop']);

export const connectionStatusEnum = pgEnum('connection_status', [
  'pending',
  'active',
  'expired',
  'revoked',
  'error',
]);

/** How a RawEvent arrived. Drives which normalizer runs. */
export const ingestSourceEnum = pgEnum('ingest_source', [
  'webhook',
  'backfill',
  'file_upload',
  'csv_import',
]);

export const signalEnum = pgEnum('signal', [
  'hrv',
  'resting_hr',
  'sleep',
  'load', // training load / TRIMP
]);

export const sportEnum = pgEnum('sport', [
  'run',
  'bike',
  'swim',
  'strength',
  'cross_train',
  'other',
]);

/**
 * The sport a coaching plan is built for. Distinct from `sport` (which tags
 * ingested activities across many modalities): `discipline` is the narrower set
 * the coaching engine actually periodizes for. 'run' is the original; 'bike'
 * and 'swim' are added behind the engine's discipline strategy seam.
 */
export const disciplineEnum = pgEnum('discipline', ['run', 'bike', 'swim']);

export const sessionTypeEnum = pgEnum('session_type', [
  'recovery',
  'easy',
  'maintenance', // steady aerobic (coach's "maintenance pace")
  'marathon', // marathon-pace work
  'long',
  'tempo',
  'threshold',
  'intervals',
  'race',
  'rest',
  'cross_train',
]);

export const planStatusEnum = pgEnum('plan_status', [
  'draft', // produced by a replan, not yet visible to athlete
  'published', // approved by coach, athlete-visible
  'superseded',
]);

/** Injury lifecycle from the spec: acute → returning → cleared. */
export const injuryStatusEnum = pgEnum('injury_status', [
  'acute',
  'returning',
  'cleared',
]);

export const injurySeverityEnum = pgEnum('injury_severity', [
  'niggle',
  'moderate',
  'severe',
]);

/**
 * Race priority within a season: the `goal` race anchors the build; `tune_up`
 * races are real-effort building races (get a sharpening taper); `training`
 * races are run through as workouts.
 */
export const racePriorityEnum = pgEnum('race_priority', ['goal', 'tune_up', 'training', 'other']);

export const raceGoalTypeEnum = pgEnum('race_goal_type', ['time', 'pace', 'place', 'effort', 'none']);

export const raceStatusEnum = pgEnum('race_status', ['planned', 'completed', 'skipped']);

/** Who drives this athlete's coaching: a human coach (assisted) or the app. */
export const coachingModeEnum = pgEnum('coaching_mode', ['assisted', 'autonomous']);

/** Why the autopilot escalated to a human instead of auto-publishing. */
export const escalationKindEnum = pgEnum('escalation_kind', [
  'active_injury',
  'repeated_low_readiness',
  'large_plan_change',
  'stale_data',
  'other',
]);

export const escalationStatusEnum = pgEnum('escalation_status', ['open', 'acknowledged', 'resolved']);

export const feedbackStatusEnum = pgEnum('feedback_status', ['open', 'addressed']);

/** Structured coach instruction kinds. Effect-windowed. */
export const directiveKindEnum = pgEnum('directive_kind', [
  'intensity_cap',
  'volume_ceiling',
  'no_run_days',
  'rest_day',
  'modality_constraint',
  'availability',
  'other',
]);

/**
 * Coach-defined reason-code taxonomy for overrides. The weekly distribution of
 * these IS the engine-deficiency report (Phase 4, screen 6). Extend as the
 * coach's vocabulary grows — keep it an explicit enum so it stays gradeable.
 */
export const overrideReasonEnum = pgEnum('override_reason', [
  'too_aggressive',
  'too_cautious',
  'injury_judgment',
  'life_stress',
  'travel',
  'weather',
  'race_strategy',
  'athlete_request',
  'data_quality',
  'other',
]);

// ---------------------------------------------------------------------------
// Athlete & onboarding
// ---------------------------------------------------------------------------

export const athletes = pgTable(
  'athletes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fullName: text('full_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    timezone: text('timezone').notNull().default('UTC'), // IANA tz, e.g. 'America/New_York'
    dateOfBirth: date('date_of_birth'), // for age-grading / masters pace defaults
    sex: text('sex'), // 'female' | 'male' | 'other' | null — gates cycle tracking, age-grading
    goalRace: text('goal_race'),
    goalRaceDate: date('goal_race_date'),
    // Realistic TOTAL weekly training HOURS across all disciplines — the shared
    // budget the dual-sport coordinator splits between a coexisting run + bike
    // goal (see server/dualSeason.ts). Null until the athlete sets it.
    weeklyHoursBudget: doublePrecision('weekly_hours_budget'),
    // The sport this athlete is coached for. Additive: existing athletes default
    // to 'run', preserving all current behaviour.
    discipline: disciplineEnum('discipline').notNull().default('run'),
    // Per-athlete pace customization (AthletePaceConfig): VDOT/threshold anchor
    // + per-zone overrides, layered on the global model. Null = pure global.
    paceConfig: jsonb('pace_config'),
    // Per-athlete CYCLING customization (AthletePowerConfig): FTP anchor (watts) /
    // FTP-test / LTHR + per-zone overrides, layered on the global power model.
    // The power-side analog of paceConfig. Null = pure global. (Cycling story 1.)
    powerConfig: jsonb('power_config'),
    // Per-athlete SWIM customization (AthleteSwimConfig): CSS anchor (m/s) /
    // swim-test + CSS-relative zone overrides, layered on the global swim model.
    // The swim-side analog of paceConfig/powerConfig. Null = pure global. This is
    // what feeds LoadAnchors.cssMetersPerSec (getAthleteCss) so swim load prices
    // as `css` confidence instead of the `estimated` fallback. (Swim leg.)
    swimConfig: jsonb('swim_config'),
    // Auth account that owns this athlete record (linked by email on first
    // sign-in). Null until the athlete signs in. `users` is defined lower in
    // this file; the reference callback is lazy so the forward ref is fine.
    userId: text('user_id').references((): import('drizzle-orm/pg-core').AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    // WHICH coach works with this athlete (users.id of a coach/admin account).
    // Null = unassigned — visible to every coach until an admin assigns one.
    coachUserId: text('coach_user_id').references((): import('drizzle-orm/pg-core').AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    // Who coaches this athlete: a human (assisted) or the app (autonomous).
    coachingMode: coachingModeEnum('coaching_mode').notNull().default('assisted'),
    active: boolean('active').notNull().default(true),
    notifyEmail: boolean('notify_email').notNull().default(true), // opt-in for proactive nudges
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }), // self-service onboarding finished
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('athletes_email_uq').on(t.email)],
);

/**
 * Global engine settings — a single row (id='global'). Holds the overall pace
 * model (GlobalPaceModel) the coach tunes once for everyone; per-athlete
 * paceConfig layers on top.
 */
export const engineSettings = pgTable('engine_settings', {
  id: text('id').primaryKey().default('global'),
  paceModel: jsonb('pace_model'), // GlobalPaceModel
  powerModel: jsonb('power_model'), // GlobalPowerModel (cycling analog of paceModel)
  swimModel: jsonb('swim_model'), // GlobalSwimModel (swim analog of paceModel/powerModel)
  // Load-currency cutover flag (spec story L2): 'trimp' | 'tss'. NULL = default
  // ('trimp'), so shipping the column changes nothing until an owner flips it.
  // Read via db/loadCurrencyConfig.ts:getLoadCurrency (env LOAD_CURRENCY overrides
  // this). See docs/multisport/load-currency-transfer-spec.md §2.4.
  loadCurrency: text('load_currency'), // 'trimp' | 'tss' | null
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const intakeProfiles = pgTable('intake_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  athleteId: uuid('athlete_id')
    .notNull()
    .references(() => athletes.id, { onDelete: 'cascade' }),
  // Coach-style onboarding answers. Free-ish structure kept in jsonb so the
  // intake questionnaire can evolve without migrations; promoted columns below
  // are the ones the engine reads directly.
  raceHistory: jsonb('race_history'), // [{ race, date, distanceMeters, timeSeconds }]
  prs: jsonb('prs'), // { '5k': seconds, '10k': seconds, 'half': ..., 'marathon': ... }
  typicalWeeklyVolumeKm: doublePrecision('typical_weekly_volume_km'),
  trainingDaysAvailable: integer('training_days_available'),
  injuryHistory: jsonb('injury_history'),
  currentPlan: text('current_plan'),
  answers: jsonb('answers'), // full raw questionnaire
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Races in an athlete's season. Exactly one `goal` race anchors the build;
 * `tune_up` races are real-effort building races (the engine inserts a
 * sharpening taper around them); each carries a goal (target time and/or pace,
 * important for the interim races). Mirrors the coach's "Races" sheet.
 */
export const races = pgTable(
  'races',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    date: date('date').notNull(),
    // Which sport this race belongs to. Lets a runner and a cyclist goal coexist
    // for one athlete: each single-sport setup only replaces races of its own
    // discipline. A triathlon setup owns all three legs and clears everything.
    discipline: disciplineEnum('discipline').notNull().default('run'),
    distanceMeters: doublePrecision('distance_meters'),
    distanceLabel: text('distance_label'), // coach shorthand: 'Mile','5k','10k','Half','Marathon'
    priority: racePriorityEnum('priority').notNull().default('tune_up'),
    // Coach-facing reason for the race (rust-buster, sharpening, competitive,
    // pacing, etc.). `priority` above is derived from this for the engine's taper
    // logic; `purpose` is what the coach/athlete actually picked. See racePurpose.ts.
    purpose: text('purpose'),
    goalType: raceGoalTypeEnum('goal_type').notNull().default('none'),
    targetTimeSeconds: integer('target_time_seconds'),
    targetPaceSecPerKm: doublePrecision('target_pace_sec_per_km'),
    effort: text('effort'), // free text: 'race effort', 'tempo effort', 'training race', …
    status: raceStatusEnum('status').notNull().default('planned'),
    resultTimeSeconds: integer('result_time_seconds'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('races_athlete_date_idx').on(t.athleteId, t.date)],
);

/**
 * Autopilot escalations: when an athlete is coached autonomously but a guardrail
 * trips, the app holds off auto-publishing and raises an escalation for a human
 * to review. The open set is the autonomous-mode "needs attention" queue.
 */
export const escalations = pgTable(
  'escalations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    kind: escalationKindEnum('kind').notNull(),
    status: escalationStatusEnum('status').notNull().default('open'),
    reason: text('reason').notNull(),
    context: jsonb('context'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [index('escalations_athlete_status_idx').on(t.athleteId, t.status)],
);

/**
 * In-app feedback from the coach (the product's quality bar). Captured in
 * context — `path` records the page they were on — so the builder can triage
 * "I'd do this differently" notes against exactly what they were looking at.
 * Not tied to an athlete FK on purpose; the path carries that context.
 */
export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    author: text('author').notNull().default('Heather'),
    path: text('path'), // page the feedback was left on
    category: text('category'), // 'plans' | 'paces' | 'races' | 'ui' | 'bug' | 'idea' | …
    body: text('body').notNull(),
    status: feedbackStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    addressedAt: timestamp('addressed_at', { withTimezone: true }),
  },
  (t) => [index('feedback_status_idx').on(t.status)],
);

// ---------------------------------------------------------------------------
// Provider connection
// ---------------------------------------------------------------------------

export const connectedAccounts = pgTable(
  'connected_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    provider: providerEnum('provider').notNull(),
    providerUserId: text('provider_user_id'), // Garmin User Access Token id / UAT
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    scopes: text('scopes').array(),
    status: connectionStatusEnum('status').notNull().default('pending'),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('connected_accounts_provider_user_uq').on(t.provider, t.providerUserId),
    index('connected_accounts_athlete_idx').on(t.athleteId),
  ],
);

// ---------------------------------------------------------------------------
// RawEvent — APPEND-ONLY source of truth
// ---------------------------------------------------------------------------

/**
 * Every inbound payload, verbatim. NEVER mutate a row here. Normalizers read
 * from this table and write derived rows elsewhere; re-running a normalizer
 * must reproduce identical derived state. `processedAt` is the one allowed
 * write — a marker that a normalizer has consumed the row — and is set exactly
 * once.
 */
export const rawEvents = pgTable(
  'raw_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id').references(() => athletes.id, {
      onDelete: 'set null',
    }), // nullable: webhook may arrive before we've mapped the provider user
    provider: providerEnum('provider').notNull(),
    source: ingestSourceEnum('source').notNull(),
    eventType: text('event_type').notNull(), // e.g. 'activities', 'dailies', 'sleeps'
    providerUserId: text('provider_user_id'),
    payload: jsonb('payload').notNull(), // raw JSON exactly as received
    payloadHash: text('payload_hash').notNull(), // for idempotent webhook dedup
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }), // set once when normalized
  },
  (t) => [
    index('raw_events_athlete_idx').on(t.athleteId),
    index('raw_events_type_idx').on(t.provider, t.eventType),
    index('raw_events_received_idx').on(t.receivedAt),
    uniqueIndex('raw_events_dedup_uq').on(t.provider, t.eventType, t.payloadHash),
  ],
);

// ---------------------------------------------------------------------------
// Normalized signals (all derived from RawEvent)
// ---------------------------------------------------------------------------

export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    rawEventId: uuid('raw_event_id').references(() => rawEvents.id, {
      onDelete: 'set null',
    }),
    sport: sportEnum('sport').notNull().default('run'),
    provider: providerEnum('provider').notNull().default('manual'), // source (for cross-source dedup)
    name: text('name'), // activity title from the provider (e.g. Strava "Morning Run")
    workoutType: integer('workout_type'), // provider workout type (Strava: 1 = race)
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    durationSeconds: integer('duration_seconds'), // MOVING time (nullable: manual imports often lack duration)
    elapsedSeconds: integer('elapsed_seconds'), // wall-clock incl. stops; elapsed − moving = time stopped
    surface: text('surface'), // 'road' | 'trail' | null (from provider sport_type)
    distanceMeters: doublePrecision('distance_meters'),
    avgHr: integer('avg_hr'),
    maxHr: integer('max_hr'),
    avgPaceSecPerKm: doublePrecision('avg_pace_sec_per_km'),
    elevationGainMeters: doublePrecision('elevation_gain_meters'), // total ascent (Strava total_elevation_gain)
    // Which pair of shoes this run was logged in. Defaults to the athlete's
    // active default pair at ingest; the athlete can override per activity.
    // `shoes` is defined lower in this file; the reference callback is lazy.
    shoeId: uuid('shoe_id').references((): import('drizzle-orm/pg-core').AnyPgColumn => shoes.id, {
      onDelete: 'set null',
    }),
    cadence: integer('cadence'),
    trainingLoad: doublePrecision('training_load'), // derived TRIMP/load impulse (legacy currency — what the PMC reads today)
    // --- Load-currency unification (spec story L1), NON-DESTRUCTIVE parallel columns ---
    // The new TSS-equivalent currency (Load = IF² × hours × 100), computed by the
    // backfill (scripts/backfill-load-tss.ts) alongside the legacy `trainingLoad`.
    // NULLABLE and unread by the app: nothing switches to these until the later,
    // owner-signed-off cutover (story L2). See docs/multisport/load-currency-transfer-spec.md.
    trainingLoadTss: doublePrecision('training_load_tss'), // TSS-equivalent load (parallel to trainingLoad)
    loadConfidence: text('load_confidence'), // provenance tier: 'power' | 'pace' | 'css' | 'hr' | 'estimated'
    splits: jsonb('splits'), // [{ distanceMeters, durationSeconds, avgHr, paceSecPerKm, elevDiffMeters }]
    laps: jsonb('laps'), // watch/interval laps [{ distanceMeters, durationSeconds, avgHr }] — finer than splits for rep workouts
    mapPolyline: text('map_polyline'), // encoded route polyline (Strava map.summary_polyline)
    sourceRef: text('source_ref'), // provider activity id
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('activities_athlete_start_idx').on(t.athleteId, t.startTime),
    uniqueIndex('activities_source_ref_uq').on(t.sourceRef),
  ],
);

/**
 * A pair of running shoes. Mileage accrues from `activities.shoe_id`; the
 * athlete's active default pair is auto-assigned to new runs at ingest, and they
 * can override any activity. `initialMiles` carries wear from before tracking;
 * `maxMiles` is the wear threshold for the "replace soon" nudge.
 */
export const shoes = pgTable(
  'shoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    brand: text('brand'),
    startDate: date('start_date'), // put into service
    retiredAt: date('retired_at'), // null = active
    isDefault: boolean('is_default').notNull().default(false),
    initialMiles: doublePrecision('initial_miles').notNull().default(0),
    maxMiles: doublePrecision('max_miles').notNull().default(500),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('shoes_athlete_idx').on(t.athleteId)],
);

export const dailySummaries = pgTable(
  'daily_summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    rawEventId: uuid('raw_event_id').references(() => rawEvents.id, {
      onDelete: 'set null',
    }),
    day: date('day').notNull(), // athlete-local calendar day
    provider: providerEnum('provider').notNull().default('manual'), // source of this record
    steps: integer('steps'),
    restingHr: integer('resting_hr'),
    avgStressLevel: integer('avg_stress_level'),
    bodyBatteryLow: integer('body_battery_low'),
    bodyBatteryHigh: integer('body_battery_high'),
    metrics: jsonb('metrics'), // any extra provider fields
  },
  (t) => [uniqueIndex('daily_summaries_athlete_day_uq').on(t.athleteId, t.day)],
);

export const sleepRecords = pgTable(
  'sleep_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    rawEventId: uuid('raw_event_id').references(() => rawEvents.id, {
      onDelete: 'set null',
    }),
    day: date('day').notNull(), // the wake-up day this sleep belongs to
    provider: providerEnum('provider').notNull().default('manual'),
    totalSleepSeconds: integer('total_sleep_seconds'),
    deepSeconds: integer('deep_seconds'),
    remSeconds: integer('rem_seconds'),
    lightSeconds: integer('light_seconds'),
    awakeSeconds: integer('awake_seconds'),
    sleepScore: integer('sleep_score'),
    metrics: jsonb('metrics'),
  },
  (t) => [uniqueIndex('sleep_records_athlete_day_uq').on(t.athleteId, t.day)],
);

export const hrvRecords = pgTable(
  'hrv_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    rawEventId: uuid('raw_event_id').references(() => rawEvents.id, {
      onDelete: 'set null',
    }),
    day: date('day').notNull(),
    provider: providerEnum('provider').notNull().default('manual'),
    overnightAvgMs: doublePrecision('overnight_avg_ms'), // RMSSD-style overnight HRV
    metrics: jsonb('metrics'),
  },
  (t) => [uniqueIndex('hrv_records_athlete_day_uq').on(t.athleteId, t.day)],
);

export const restingHrRecords = pgTable(
  'resting_hr_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    rawEventId: uuid('raw_event_id').references(() => rawEvents.id, {
      onDelete: 'set null',
    }),
    day: date('day').notNull(),
    provider: providerEnum('provider').notNull().default('manual'),
    restingHr: integer('resting_hr').notNull(),
    metrics: jsonb('metrics'),
  },
  (t) => [uniqueIndex('resting_hr_records_athlete_day_uq').on(t.athleteId, t.day)],
);

// ---------------------------------------------------------------------------
// Subjective input
// ---------------------------------------------------------------------------

export const checkIns = pgTable(
  'check_ins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    soreness: integer('soreness'), // 0-10
    energy: integer('energy'), // 0-10 (mood/energy)
    yesterdayRpe: integer('yesterday_rpe'), // 0-10 RPE of yesterday's session
    note: text('note'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('check_ins_athlete_day_uq').on(t.athleteId, t.day)],
);

/**
 * Opt-in menstrual cycle tracking (athlete-entered). Used to anticipate phases
 * for race/workout planning — late luteal often brings fatigue, so athletes may
 * avoid key racing then. One row per athlete.
 */
export const cycleTracking = pgTable('cycle_tracking', {
  athleteId: uuid('athlete_id')
    .primaryKey()
    .references(() => athletes.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(false),
  lastStartDate: date('last_start_date'), // first day of the most recent period
  avgCycleDays: integer('avg_cycle_days').notNull().default(28),
  avgPeriodDays: integer('avg_period_days').notNull().default(5),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Derived athlete state (re-derivable from signals)
// ---------------------------------------------------------------------------

/**
 * Per athlete, per signal, per day: rolling short (7d) and long (60d) stats.
 * Readings are consumed by the engine as z-scores vs the athlete's OWN
 * baseline — no absolute thresholds anywhere.
 */
export const baselines = pgTable(
  'baselines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    signal: signalEnum('signal').notNull(),
    day: date('day').notNull(),
    shortMean: doublePrecision('short_mean'), // 7d
    shortStd: doublePrecision('short_std'),
    longMean: doublePrecision('long_mean'), // 60d
    longStd: doublePrecision('long_std'),
    latestValue: doublePrecision('latest_value'),
    latestZ: doublePrecision('latest_z'), // (latest - longMean) / longStd
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('baselines_athlete_signal_day_uq').on(t.athleteId, t.signal, t.day)],
);

/** Banister-style chronic/acute load and balance. Recomputed on new data. */
export const fitnessFatigueStates = pgTable(
  'fitness_fatigue_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    // Cross-sport transfer model (spec L3): each (athlete, day) now carries up to
    // THREE tracks per trained discipline — `central:<d>` (transferable aerobic),
    // `specific:<d>` (economy), `durability:<d>` (impact). ADDITIVE + backward
    // compatible: legacy single-series rows default to 'central', and for a
    // run-only athlete `central:run` reproduces the exact legacy curve. See
    // engine/transferLogic.ts:trackId and docs/multisport/load-currency-transfer-spec.md §3.3.
    track: text('track').notNull().default('central'),
    ctl: doublePrecision('ctl').notNull(), // chronic training load (fitness)
    atl: doublePrecision('atl').notNull(), // acute training load (fatigue)
    tsb: doublePrecision('tsb').notNull(), // training stress balance (ctl - atl)
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Uniqueness is now per (athlete, day, TRACK) so the parallel tracks coexist.
  (t) => [uniqueIndex('ff_states_athlete_day_track_uq').on(t.athleteId, t.day, t.track)],
);

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    status: planStatusEnum('status').notNull().default('draft'),
    // Sport this plan periodizes for; defaults to 'run' for every existing plan.
    discipline: disciplineEnum('discipline').notNull().default('run'),
    weekStart: date('week_start').notNull(), // first day (Monday) of the planned week
    weekEnd: date('week_end').notNull(),
    phase: text('phase'), // base | build | peak | taper
    cycle: integer('cycle'), // 1-based mesocycle index
    weeklyTargetMeters: doublePrecision('weekly_target_meters'),
    // Discipline-generic weekly load: TSS-equivalent target for the bike (the
    // `weekly_target_meters` analog). Null on running plans. Additive (spec §4.3).
    weeklyTargetTss: doublePrecision('weekly_target_tss'),
    rationale: text('rationale'), // the "Things to think about" note
    // Deterministic provenance: the exact inputs this plan was generated from,
    // so the same (state, constraints, directives, pins) reproduce it.
    generatedFrom: jsonb('generated_from'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('plans_athlete_status_idx').on(t.athleteId, t.status),
    index('plans_athlete_week_idx').on(t.athleteId, t.weekStart),
  ],
);

export const plannedSessions = pgTable(
  'planned_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    // Sport of this session; defaults to 'run' for every existing session.
    discipline: disciplineEnum('discipline').notNull().default('run'),
    sessionType: sessionTypeEnum('session_type').notNull(),
    zone: text('zone'), // pace zone key (recovery…rep); null for rest/cross_train
    targetLoad: doublePrecision('target_load'),
    targetDistanceMeters: doublePrecision('target_distance_meters'),
    targetPaceSecPerKm: doublePrecision('target_pace_sec_per_km'), // zone midpoint
    targetPaceFastSecPerKm: doublePrecision('target_pace_fast_sec_per_km'), // zone fast bound
    targetPaceSlowSecPerKm: doublePrecision('target_pace_slow_sec_per_km'), // zone slow bound
    // --- cycling: duration-at-power prescription (the distance/pace analog) ---
    targetDurationSeconds: doublePrecision('target_duration_seconds'), // total incl. wu/cd
    targetPowerLowWatts: doublePrecision('target_power_low_watts'), // primary-zone watt band, low
    targetPowerHighWatts: doublePrecision('target_power_high_watts'), // primary-zone watt band, high
    warmup: text('warmup'),
    cooldown: text('cooldown'),
    segments: jsonb('segments'), // structured workout segments (warmup/work/cooldown)
    description: text('description'), // engine's structured intent (LLM phrases for athlete later)
    // A pinned session was hand-set by the coach; the planner must route AROUND
    // it rather than regenerate it. This is how interventions edit inputs.
    pinned: boolean('pinned').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('planned_sessions_plan_day_idx').on(t.planId, t.day)],
);

// ---------------------------------------------------------------------------
// Coach inputs: directives, injuries, notes
// ---------------------------------------------------------------------------

/**
 * Structured coach instruction with an effect window. If it came from free
 * text, `sourceText` preserves the original; the LLM translated it but the
 * structured form is the only thing the engine reads.
 */
export const directives = pgTable(
  'directives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    kind: directiveKindEnum('kind').notNull(),
    params: jsonb('params'), // e.g. { capRpe: 5 } or { maxWeeklyKm: 40 } or { days: ['Sun'] }
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'), // null = open-ended
    sourceText: text('source_text'), // original free-text, if any
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('directives_athlete_active_idx').on(t.athleteId, t.active)],
);

export const injuryRecords = pgTable(
  'injury_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    bodyPart: text('body_part').notNull(),
    severity: injurySeverityEnum('severity').notNull(),
    status: injuryStatusEnum('status').notNull().default('acute'),
    allowedModalities: text('allowed_modalities').array(), // e.g. ['bike','swim','pool_run']
    onsetDate: date('onset_date').notNull(),
    clearedDate: date('cleared_date'),
    // Athlete-driven return flow: whether they said they can keep training
    // through it, and the self-set date to proactively check "ready to resume?".
    canContinue: boolean('can_continue'),
    checkBackDate: date('check_back_date'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('injury_records_athlete_status_idx').on(t.athleteId, t.status)],
);

/**
 * Standing per-athlete memory consumed by the engine at plan time
 * (e.g. "underreports soreness"). Structured so the engine can act on it.
 */
export const athleteNotes = pgTable(
  'athlete_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    kind: text('kind'), // e.g. 'reporting_bias', 'preference', 'context'
    body: text('body').notNull(),
    params: jsonb('params'), // optional machine-usable form, e.g. { sorenessBiasAdjust: 1 }
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('athlete_notes_athlete_active_idx').on(t.athleteId, t.active)],
);

// ---------------------------------------------------------------------------
// Override — APPEND-ONLY audit of every coach change to engine output
// ---------------------------------------------------------------------------

/**
 * Every coach change to an engine output, captured as labeled training data.
 * before/after snapshots + a reason code (and optional note). NEVER mutate or
 * delete. The weekly reason-code distribution is the engine-deficiency report.
 */
export const overrides = pgTable(
  'overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(), // 'planned_session' | 'readiness' | ...
    targetId: uuid('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    reasonCode: overrideReasonEnum('reason_code').notNull(),
    note: text('note'),
    createdBy: text('created_by'), // coach identifier
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('overrides_athlete_idx').on(t.athleteId),
    index('overrides_reason_idx').on(t.reasonCode),
    index('overrides_created_idx').on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Readiness assessment (Phase 2 writes here; defined now so it's stable)
// ---------------------------------------------------------------------------

export const readinessAssessments = pgTable(
  'readiness_assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    score: doublePrecision('score'), // small interpretable score
    band: text('band'), // e.g. 'easy' | 'normal' | 'go'
    sentence: text('sentence'), // the one defensible sentence
    drivers: jsonb('drivers'), // [{ signal, z, contribution }] — explainability
    // Coach grading for the Phase 2 validation harness / eval set.
    coachGrade: text('coach_grade'), // 'agree' | 'too_cautious' | 'too_aggressive' | null
    gradedAt: timestamp('graded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('readiness_athlete_day_uq').on(t.athleteId, t.day)],
);

// ---------------------------------------------------------------------------
// Auth (Auth.js v5 + Drizzle adapter)
// ---------------------------------------------------------------------------
// Canonical Auth.js Postgres tables. Property names match what the adapter
// expects; do not rename them. `role` gates coach vs athlete access, and
// `athletes.userId` links a signed-in user to their athlete record (by email
// on first sign-in). See src/auth.ts.

// admin = site owner (all athletes + site-wide analytics); coach = works with
// their assigned athletes only; athlete = their own portal.
export const userRoleEnum = pgEnum('user_role', ['admin', 'coach', 'athlete']);

export const users = pgTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date', withTimezone: true }),
  image: text('image'),
  role: userRoleEnum('role').notNull().default('athlete'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---------------------------------------------------------------------------
// Notifications: append-only log of proactive nudges actually sent. Doubles as
// the dedup ledger — the nudge sender checks "did we already send today?" here.
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // NudgeKind: workout_today | streak_protect | comeback
    channel: text('channel').notNull().default('email'),
    localDay: date('local_day').notNull(), // athlete-local date the nudge was for (dedup key)
    subject: text('subject'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_athlete_idx').on(t.athleteId, t.localDay),
    // At most one nudge per athlete per local day (dedup guarantee).
    uniqueIndex('notifications_athlete_day_uq').on(t.athleteId, t.localDay),
  ],
);

// ---------------------------------------------------------------------------
// Athlete's own post-run read ("how did it feel?") — the subjective signal the
// sensors can't see (felt unwell, took breaks, surface). Kept separate from the
// provider-synced `activities` row; feeds the post-run debrief.
// ---------------------------------------------------------------------------

export const activityFeedback = pgTable(
  'activity_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    feel: text('feel'), // 'strong' | 'fine' | 'rough'
    effort: integer('effort'), // optional RPE 1–10
    tookBreaks: boolean('took_breaks'), // null = not answered
    surface: text('surface'), // athlete-reported: 'road' | 'trail' | 'track' | 'treadmill'
    unwell: boolean('unwell'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('activity_feedback_activity_uq').on(t.activityId)],
);

/**
 * Cached LLM narration of a run's debrief. The "what went well / focus next"
 * prose is generated ONCE per distinct set of grounded signals and reused, so it
 * doesn't regenerate (and drift) on every page load. `signature` is a hash of
 * the signals; when the athlete's feedback changes the signals change, the
 * signature changes, and we re-narrate exactly once.
 */
export const runDebriefs = pgTable(
  'run_debriefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => athletes.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    signature: text('signature').notNull(), // hash of the grounded signals
    headline: text('headline').notNull(),
    wentWell: text('went_well').notNull(),
    focusNext: text('focus_next').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('run_debriefs_activity_uq').on(t.activityId)],
);
