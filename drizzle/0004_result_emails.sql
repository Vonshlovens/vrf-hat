CREATE TABLE "result_email_settings" (
	"raffle_id" uuid PRIMARY KEY NOT NULL,
	"email_host" boolean DEFAULT true NOT NULL,
	"email_members" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "result_recipient" (
	"raffle_id" uuid NOT NULL,
	"email" text NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_recipient_raffle_id_email_pk" PRIMARY KEY("raffle_id","email")
);
--> statement-breakpoint
ALTER TABLE "draw" ADD COLUMN "results_emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "result_email_settings" ADD CONSTRAINT "result_email_settings_raffle_id_raffle_id_fk" FOREIGN KEY ("raffle_id") REFERENCES "public"."raffle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_recipient" ADD CONSTRAINT "result_recipient_raffle_id_raffle_id_fk" FOREIGN KEY ("raffle_id") REFERENCES "public"."raffle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_recipient" ADD CONSTRAINT "result_recipient_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Rounds drawn before result emails existed count as already sent.
UPDATE "draw" SET "results_emailed_at" = "drawn_at" WHERE "drawn_at" IS NOT NULL;
