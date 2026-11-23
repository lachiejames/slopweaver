CREATE TABLE "owner_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" uuid,
	"display_name" text NOT NULL,
	"self_description" jsonb NOT NULL,
	"judgement_profile" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_profile_is_singleton" CHECK (id = 'owner')
);
--> statement-breakpoint
ALTER TABLE "owner_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "owner_voice_register" (
	"owner_id" text NOT NULL,
	"surface" text NOT NULL,
	"cohort" text NOT NULL,
	"median_words" integer,
	"p75_words" integer,
	"p90_words" integer,
	"ceiling_words" integer,
	"sample_count" integer,
	"measured_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"qualification" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_voice_register_pk" PRIMARY KEY("owner_id","surface","cohort"),
	CONSTRAINT "owner_voice_register_non_negative" CHECK ((median_words is null or median_words >= 0)
        and (p75_words is null or p75_words >= 0)
        and (p90_words is null or p90_words >= 0)
        and (ceiling_words is null or ceiling_words >= 0)
        and (sample_count is null or sample_count >= 0))
);
--> statement-breakpoint
ALTER TABLE "owner_voice_register" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "judgement" jsonb;--> statement-breakpoint
ALTER TABLE "owner_profile" ADD CONSTRAINT "owner_profile_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_voice_register" ADD CONSTRAINT "owner_voice_register_owner_id_owner_profile_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "owner_profile_owner_all" ON "owner_profile" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "owner_profile_agent_read" ON "owner_profile" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "owner_profile_bot_read" ON "owner_profile" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);--> statement-breakpoint
CREATE POLICY "owner_voice_register_owner_all" ON "owner_voice_register" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "owner_voice_register_agent_read" ON "owner_voice_register" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "owner_voice_register_bot_read" ON "owner_voice_register" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);