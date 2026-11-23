CREATE TABLE "measurement_blob" (
	"body_sha256" text PRIMARY KEY NOT NULL,
	"byte_length" integer NOT NULL,
	"media_type" text NOT NULL,
	"placement" text NOT NULL,
	"body" text,
	"first_imported_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_blob_sha_shape" CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "measurement_blob_byte_length_non_negative" CHECK (byte_length >= 0),
	CONSTRAINT "measurement_blob_placement" CHECK (placement in ('inline', 'storage')),
	CONSTRAINT "measurement_blob_body_matches_placement" CHECK ((placement = 'inline') = (body is not null))
);
--> statement-breakpoint
ALTER TABLE "measurement_blob" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "measurement_location" (
	"relative_path" text NOT NULL,
	"body_sha256" text NOT NULL,
	"class" text NOT NULL,
	"file_modified_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_location_pk" PRIMARY KEY("relative_path","recorded_at"),
	CONSTRAINT "measurement_location_class" CHECK (class in ('bakeoff', 'datadog-shots', 'evidence', 'proof')),
	CONSTRAINT "measurement_location_path_shape" CHECK (relative_path !~ '^/' and relative_path !~ '(^|/)\.\.(/|$)')
);
--> statement-breakpoint
ALTER TABLE "measurement_location" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "measurement_location" ADD CONSTRAINT "measurement_location_body_sha256_measurement_blob_body_sha256_fk" FOREIGN KEY ("body_sha256") REFERENCES "public"."measurement_blob"("body_sha256") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_measurement_location_path_time" ON "measurement_location" USING btree ("relative_path","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_measurement_location_class" ON "measurement_location" USING btree ("class","relative_path");--> statement-breakpoint
CREATE INDEX "idx_measurement_location_sha" ON "measurement_location" USING btree ("body_sha256");--> statement-breakpoint
CREATE POLICY "measurement_blob_owner_all" ON "measurement_blob" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "measurement_blob_agent_read" ON "measurement_blob" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "measurement_blob_bot_read" ON "measurement_blob" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "measurement_location_owner_all" ON "measurement_location" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "measurement_location_agent_read" ON "measurement_location" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "measurement_location_bot_read" ON "measurement_location" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);