ALTER TABLE "planned_sessions" ADD COLUMN "target_duration_seconds" double precision;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD COLUMN "target_power_low_watts" double precision;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD COLUMN "target_power_high_watts" double precision;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "weekly_target_tss" double precision;