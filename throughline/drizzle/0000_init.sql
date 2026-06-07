CREATE TYPE "public"."connection_status" AS ENUM('pending', 'active', 'expired', 'revoked', 'error');--> statement-breakpoint
CREATE TYPE "public"."directive_kind" AS ENUM('intensity_cap', 'volume_ceiling', 'no_run_days', 'rest_day', 'modality_constraint', 'availability', 'other');--> statement-breakpoint
CREATE TYPE "public"."ingest_source" AS ENUM('webhook', 'backfill', 'file_upload', 'csv_import');--> statement-breakpoint
CREATE TYPE "public"."injury_severity" AS ENUM('niggle', 'moderate', 'severe');--> statement-breakpoint
CREATE TYPE "public"."injury_status" AS ENUM('acute', 'returning', 'cleared');--> statement-breakpoint
CREATE TYPE "public"."override_reason" AS ENUM('too_aggressive', 'too_cautious', 'injury_judgment', 'life_stress', 'travel', 'weather', 'race_strategy', 'athlete_request', 'data_quality', 'other');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('garmin', 'manual');--> statement-breakpoint
CREATE TYPE "public"."session_type" AS ENUM('recovery', 'easy', 'maintenance', 'marathon', 'long', 'tempo', 'threshold', 'intervals', 'race', 'rest', 'cross_train');--> statement-breakpoint
CREATE TYPE "public"."signal" AS ENUM('hrv', 'resting_hr', 'sleep', 'load');--> statement-breakpoint
CREATE TYPE "public"."sport" AS ENUM('run', 'bike', 'swim', 'strength', 'cross_train', 'other');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"raw_event_id" uuid,
	"sport" "sport" DEFAULT 'run' NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"duration_seconds" integer,
	"distance_meters" double precision,
	"avg_hr" integer,
	"max_hr" integer,
	"avg_pace_sec_per_km" double precision,
	"cadence" integer,
	"training_load" double precision,
	"splits" jsonb,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "athlete_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"kind" text,
	"body" text NOT NULL,
	"params" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "athletes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"goal_race" text,
	"goal_race_date" date,
	"pace_config" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"signal" "signal" NOT NULL,
	"day" date NOT NULL,
	"short_mean" double precision,
	"short_std" double precision,
	"long_mean" double precision,
	"long_std" double precision,
	"latest_value" double precision,
	"latest_z" double precision,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"day" date NOT NULL,
	"soreness" integer,
	"energy" integer,
	"yesterday_rpe" integer,
	"note" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connected_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"provider_user_id" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text[],
	"status" "connection_status" DEFAULT 'pending' NOT NULL,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"raw_event_id" uuid,
	"day" date NOT NULL,
	"steps" integer,
	"resting_hr" integer,
	"avg_stress_level" integer,
	"body_battery_low" integer,
	"body_battery_high" integer,
	"metrics" jsonb
);
--> statement-breakpoint
CREATE TABLE "directives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"kind" "directive_kind" NOT NULL,
	"params" jsonb,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"source_text" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engine_settings" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"pace_model" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fitness_fatigue_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"day" date NOT NULL,
	"ctl" double precision NOT NULL,
	"atl" double precision NOT NULL,
	"tsb" double precision NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hrv_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"raw_event_id" uuid,
	"day" date NOT NULL,
	"overnight_avg_ms" double precision,
	"metrics" jsonb
);
--> statement-breakpoint
CREATE TABLE "injury_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"body_part" text NOT NULL,
	"severity" "injury_severity" NOT NULL,
	"status" "injury_status" DEFAULT 'acute' NOT NULL,
	"allowed_modalities" text[],
	"onset_date" date NOT NULL,
	"cleared_date" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"race_history" jsonb,
	"prs" jsonb,
	"typical_weekly_volume_km" double precision,
	"training_days_available" integer,
	"injury_history" jsonb,
	"current_plan" text,
	"answers" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason_code" "override_reason" NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planned_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"athlete_id" uuid NOT NULL,
	"day" date NOT NULL,
	"session_type" "session_type" NOT NULL,
	"zone" text,
	"target_load" double precision,
	"target_distance_meters" double precision,
	"target_pace_sec_per_km" double precision,
	"target_pace_fast_sec_per_km" double precision,
	"target_pace_slow_sec_per_km" double precision,
	"warmup" text,
	"cooldown" text,
	"segments" jsonb,
	"description" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"week_start" date NOT NULL,
	"week_end" date NOT NULL,
	"phase" text,
	"cycle" integer,
	"weekly_target_meters" double precision,
	"rationale" text,
	"generated_from" jsonb,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid,
	"provider" "provider" NOT NULL,
	"source" "ingest_source" NOT NULL,
	"event_type" text NOT NULL,
	"provider_user_id" text,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "readiness_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"day" date NOT NULL,
	"score" double precision,
	"band" text,
	"sentence" text,
	"drivers" jsonb,
	"coach_grade" text,
	"graded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resting_hr_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"raw_event_id" uuid,
	"day" date NOT NULL,
	"resting_hr" integer NOT NULL,
	"metrics" jsonb
);
--> statement-breakpoint
CREATE TABLE "sleep_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"raw_event_id" uuid,
	"day" date NOT NULL,
	"total_sleep_seconds" integer,
	"deep_seconds" integer,
	"rem_seconds" integer,
	"light_seconds" integer,
	"awake_seconds" integer,
	"sleep_score" integer,
	"metrics" jsonb
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete_notes" ADD CONSTRAINT "athlete_notes_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_summaries" ADD CONSTRAINT "daily_summaries_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_summaries" ADD CONSTRAINT "daily_summaries_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directives" ADD CONSTRAINT "directives_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fitness_fatigue_states" ADD CONSTRAINT "fitness_fatigue_states_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrv_records" ADD CONSTRAINT "hrv_records_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrv_records" ADD CONSTRAINT "hrv_records_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "injury_records" ADD CONSTRAINT "injury_records_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_profiles" ADD CONSTRAINT "intake_profiles_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_assessments" ADD CONSTRAINT "readiness_assessments_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resting_hr_records" ADD CONSTRAINT "resting_hr_records_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resting_hr_records" ADD CONSTRAINT "resting_hr_records_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sleep_records" ADD CONSTRAINT "sleep_records_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sleep_records" ADD CONSTRAINT "sleep_records_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_athlete_start_idx" ON "activities" USING btree ("athlete_id","start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "activities_source_ref_uq" ON "activities" USING btree ("source_ref");--> statement-breakpoint
CREATE INDEX "athlete_notes_athlete_active_idx" ON "athlete_notes" USING btree ("athlete_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "athletes_email_uq" ON "athletes" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "baselines_athlete_signal_day_uq" ON "baselines" USING btree ("athlete_id","signal","day");--> statement-breakpoint
CREATE UNIQUE INDEX "check_ins_athlete_day_uq" ON "check_ins" USING btree ("athlete_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "connected_accounts_provider_user_uq" ON "connected_accounts" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "connected_accounts_athlete_idx" ON "connected_accounts" USING btree ("athlete_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_summaries_athlete_day_uq" ON "daily_summaries" USING btree ("athlete_id","day");--> statement-breakpoint
CREATE INDEX "directives_athlete_active_idx" ON "directives" USING btree ("athlete_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "ff_states_athlete_day_uq" ON "fitness_fatigue_states" USING btree ("athlete_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "hrv_records_athlete_day_uq" ON "hrv_records" USING btree ("athlete_id","day");--> statement-breakpoint
CREATE INDEX "injury_records_athlete_status_idx" ON "injury_records" USING btree ("athlete_id","status");--> statement-breakpoint
CREATE INDEX "overrides_athlete_idx" ON "overrides" USING btree ("athlete_id");--> statement-breakpoint
CREATE INDEX "overrides_reason_idx" ON "overrides" USING btree ("reason_code");--> statement-breakpoint
CREATE INDEX "overrides_created_idx" ON "overrides" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "planned_sessions_plan_day_idx" ON "planned_sessions" USING btree ("plan_id","day");--> statement-breakpoint
CREATE INDEX "plans_athlete_status_idx" ON "plans" USING btree ("athlete_id","status");--> statement-breakpoint
CREATE INDEX "plans_athlete_week_idx" ON "plans" USING btree ("athlete_id","week_start");--> statement-breakpoint
CREATE INDEX "raw_events_athlete_idx" ON "raw_events" USING btree ("athlete_id");--> statement-breakpoint
CREATE INDEX "raw_events_type_idx" ON "raw_events" USING btree ("provider","event_type");--> statement-breakpoint
CREATE INDEX "raw_events_received_idx" ON "raw_events" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_events_dedup_uq" ON "raw_events" USING btree ("provider","event_type","payload_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "readiness_athlete_day_uq" ON "readiness_assessments" USING btree ("athlete_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "resting_hr_records_athlete_day_uq" ON "resting_hr_records" USING btree ("athlete_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "sleep_records_athlete_day_uq" ON "sleep_records" USING btree ("athlete_id","day");