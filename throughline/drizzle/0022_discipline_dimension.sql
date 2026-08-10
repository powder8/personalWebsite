CREATE TYPE "public"."discipline" AS ENUM('run', 'bike');--> statement-breakpoint
ALTER TABLE "athletes" ADD COLUMN "discipline" "discipline" DEFAULT 'run' NOT NULL;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD COLUMN "discipline" "discipline" DEFAULT 'run' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "discipline" "discipline" DEFAULT 'run' NOT NULL;