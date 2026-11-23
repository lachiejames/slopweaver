CREATE TABLE "owner_turn_location" (
	"relative_path" text NOT NULL,
	"body_sha256" text NOT NULL,
	"turn" text NOT NULL,
	"family" text NOT NULL,
	"file_modified_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_turn_location_pk" PRIMARY KEY("relative_path","body_sha256"),
	CONSTRAINT "owner_turn_location_family" CHECK (family in ('archive-turn', 'scratch-turn'))
);
--> statement-breakpoint
ALTER TABLE "owner_turn_location" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "owner_turn" (
	"body_sha256" text PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"byte_length" integer NOT NULL,
	"first_imported_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_turn_sha_shape" CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "owner_turn_byte_length_non_negative" CHECK (byte_length >= 0)
);
--> statement-breakpoint
ALTER TABLE "owner_turn" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "owner_turn_location" ADD CONSTRAINT "owner_turn_location_body_sha256_owner_turn_body_sha256_fk" FOREIGN KEY ("body_sha256") REFERENCES "public"."owner_turn"("body_sha256") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_owner_turn_location_turn_time" ON "owner_turn_location" USING btree ("turn","file_modified_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_owner_turn_location_sha" ON "owner_turn_location" USING btree ("body_sha256");--> statement-breakpoint
CREATE POLICY "owner_turn_location_owner_all" ON "owner_turn_location" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "owner_turn_location_agent_read" ON "owner_turn_location" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "owner_turn_location_bot_read" ON "owner_turn_location" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "owner_turn_owner_all" ON "owner_turn" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "owner_turn_agent_read" ON "owner_turn" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "owner_turn_bot_read" ON "owner_turn" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);