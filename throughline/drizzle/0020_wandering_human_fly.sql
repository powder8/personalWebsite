ALTER TYPE "public"."user_role" ADD VALUE 'admin' BEFORE 'coach';--> statement-breakpoint
ALTER TABLE "athletes" ADD COLUMN "coach_user_id" text;--> statement-breakpoint
ALTER TABLE "athletes" ADD CONSTRAINT "athletes_coach_user_id_users_id_fk" FOREIGN KEY ("coach_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;