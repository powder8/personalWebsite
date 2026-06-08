CREATE TABLE "shoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"start_date" date,
	"retired_at" date,
	"is_default" boolean DEFAULT false NOT NULL,
	"initial_miles" double precision DEFAULT 0 NOT NULL,
	"max_miles" double precision DEFAULT 500 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "shoe_id" uuid;--> statement-breakpoint
ALTER TABLE "shoes" ADD CONSTRAINT "shoes_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shoes_athlete_idx" ON "shoes" USING btree ("athlete_id");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_shoe_id_shoes_id_fk" FOREIGN KEY ("shoe_id") REFERENCES "public"."shoes"("id") ON DELETE set null ON UPDATE no action;