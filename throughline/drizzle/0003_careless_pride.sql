ALTER TABLE "activities" ADD COLUMN "provider" "provider" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_summaries" ADD COLUMN "provider" "provider" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "hrv_records" ADD COLUMN "provider" "provider" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "resting_hr_records" ADD COLUMN "provider" "provider" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "sleep_records" ADD COLUMN "provider" "provider" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
UPDATE "activities" SET "provider" = 'strava' WHERE "source_ref" LIKE 'strava:%';--> statement-breakpoint
UPDATE "activities" SET "provider" = 'garmin' WHERE "source_ref" LIKE 'garmin:%';
