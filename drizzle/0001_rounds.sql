CREATE TYPE "public"."raffle_mode" AS ENUM('win', 'eliminate');--> statement-breakpoint
CREATE TYPE "public"."repeat_unit" AS ENUM('hour', 'day', 'week');--> statement-breakpoint
CREATE TABLE "draw" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raffle_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_address" text NOT NULL,
	"raffle_key" text NOT NULL,
	"pick_count" integer NOT NULL,
	"entrants_root" text,
	"entrant_count" integer,
	"request_tx" text,
	"request_id" text,
	"requested_at" timestamp with time zone,
	"random_word" text,
	"drawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draw_slot" (
	"draw_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"entry_id" uuid,
	"ticket" text NOT NULL,
	"label" text NOT NULL,
	"picked_rank" integer,
	CONSTRAINT "draw_slot_draw_id_position_pk" PRIMARY KEY("draw_id","position")
);
--> statement-breakpoint
ALTER TABLE "entry" ADD COLUMN "count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "entry" ADD COLUMN "picked" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "raffle" ADD COLUMN "mode" "raffle_mode" DEFAULT 'win' NOT NULL;--> statement-breakpoint
ALTER TABLE "raffle" ADD COLUMN "recurring" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "raffle" ADD COLUMN "repeat_every" integer;--> statement-breakpoint
ALTER TABLE "raffle" ADD COLUMN "repeat_unit" "repeat_unit";--> statement-breakpoint
ALTER TABLE "raffle" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "raffle" ADD COLUMN "next_draw_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raffle" ADD COLUMN "max_draws" integer;--> statement-breakpoint
ALTER TABLE "raffle" ADD COLUMN "return_picked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "raffle" ADD COLUMN "keep_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "draw" ADD CONSTRAINT "draw_raffle_id_raffle_id_fk" FOREIGN KEY ("raffle_id") REFERENCES "public"."raffle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_slot" ADD CONSTRAINT "draw_slot_draw_id_draw_id_fk" FOREIGN KEY ("draw_id") REFERENCES "public"."draw"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_slot" ADD CONSTRAINT "draw_slot_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draw_raffle_round_uniq" ON "draw" USING btree ("raffle_id","round");--> statement-breakpoint
CREATE INDEX "draw_slot_entry_idx" ON "draw_slot" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "raffle_due_idx" ON "raffle" USING btree ("next_draw_at");--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_count_positive" CHECK ("entry"."count" > 0);--> statement-breakpoint
-- Move each existing draw off the raffle row into round 1. Pulled slots
-- (picked_rank) are filled in by the app the first time the raffle is read.
INSERT INTO "draw" ("raffle_id", "round", "chain_id", "contract_address", "raffle_key", "pick_count", "entrants_root", "entrant_count", "request_tx", "request_id", "requested_at", "random_word", "drawn_at")
SELECT "id", 1, "chain_id", "contract_address", "raffle_key", "winner_count", "entrants_root", "entrant_count", "request_tx", "request_id", "requested_at", "random_word", "drawn_at"
FROM "raffle"
WHERE "status" <> 'open' AND "raffle_key" IS NOT NULL AND "chain_id" IS NOT NULL AND "contract_address" IS NOT NULL;--> statement-breakpoint
INSERT INTO "draw_slot" ("draw_id", "position", "entry_id", "ticket", "label")
SELECT d."id", e."position", e."id", e."ticket", e."label"
FROM "entry" e JOIN "draw" d ON d."raffle_id" = e."raffle_id"
WHERE e."position" IS NOT NULL;
