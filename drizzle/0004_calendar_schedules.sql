CREATE TYPE "public"."pick_plan" AS ENUM('fixed', 'spread');--> statement-breakpoint
ALTER TABLE "raffle" ADD COLUMN "calendar" jsonb;--> statement-breakpoint
ALTER TABLE "raffle" ADD COLUMN "pick_plan" "pick_plan" DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "raffle" ADD COLUMN "pick_total" integer;