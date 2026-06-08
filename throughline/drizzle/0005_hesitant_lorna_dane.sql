CREATE TABLE "cycle_tracking" (
	"athlete_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_start_date" date,
	"avg_cycle_days" integer DEFAULT 28 NOT NULL,
	"avg_period_days" integer DEFAULT 5 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cycle_tracking" ADD CONSTRAINT "cycle_tracking_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;