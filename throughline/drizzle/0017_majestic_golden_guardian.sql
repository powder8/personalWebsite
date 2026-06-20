CREATE TABLE "run_debriefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"signature" text NOT NULL,
	"headline" text NOT NULL,
	"went_well" text NOT NULL,
	"focus_next" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_debriefs" ADD CONSTRAINT "run_debriefs_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_debriefs" ADD CONSTRAINT "run_debriefs_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_debriefs_activity_uq" ON "run_debriefs" USING btree ("activity_id");