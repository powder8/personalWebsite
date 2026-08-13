DROP INDEX "ff_states_athlete_day_uq";--> statement-breakpoint
ALTER TABLE "fitness_fatigue_states" ADD COLUMN "track" text DEFAULT 'central' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ff_states_athlete_day_track_uq" ON "fitness_fatigue_states" USING btree ("athlete_id","day","track");