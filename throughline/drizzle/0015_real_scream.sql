CREATE TABLE "activity_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"feel" text,
	"effort" integer,
	"took_breaks" boolean,
	"surface" text,
	"unwell" boolean,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_feedback" ADD CONSTRAINT "activity_feedback_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_feedback" ADD CONSTRAINT "activity_feedback_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_feedback_activity_uq" ON "activity_feedback" USING btree ("activity_id");