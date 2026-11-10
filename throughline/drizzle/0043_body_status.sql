CREATE TABLE "health_episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_on" date NOT NULL,
	"last_off_day" date NOT NULL,
	"report" text,
	"reported_on" date,
	"dismissed_on" date,
	"reraised" boolean DEFAULT false NOT NULL,
	"cleared_on" date,
	"return_days" integer,
	"resolved_on" date,
	"peak_score" double precision DEFAULT 0 NOT NULL,
	"notified_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_summaries" ADD COLUMN "respiratory_rate" double precision;--> statement-breakpoint
ALTER TABLE "daily_summaries" ADD COLUMN "spo2_pct" double precision;--> statement-breakpoint
ALTER TABLE "daily_summaries" ADD COLUMN "skin_temp_c" double precision;--> statement-breakpoint
ALTER TABLE "health_episodes" ADD CONSTRAINT "health_episodes_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_episodes_athlete_idx" ON "health_episodes" USING btree ("athlete_id","status");--> statement-breakpoint
-- Backfill the new vitals columns from what Whoop already stored in JSON blobs.
UPDATE "daily_summaries" SET
  "spo2_pct" = CASE WHEN ("metrics"->>'spo2_percentage') ~ '^[0-9]+(\.[0-9]+)?$' THEN ("metrics"->>'spo2_percentage')::double precision END,
  "skin_temp_c" = CASE WHEN ("metrics"->>'skin_temp_celsius') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN ("metrics"->>'skin_temp_celsius')::double precision END
WHERE "metrics" IS NOT NULL AND jsonb_typeof("metrics") = 'object';
--> statement-breakpoint
UPDATE "daily_summaries" d SET "respiratory_rate" = (s."metrics"->>'respiratory_rate')::double precision
FROM "sleep_records" s
WHERE s."athlete_id" = d."athlete_id" AND s."day" = d."day"
  AND s."metrics" IS NOT NULL AND jsonb_typeof(s."metrics") = 'object'
  AND (s."metrics"->>'respiratory_rate') ~ '^[0-9]+(\.[0-9]+)?$';
