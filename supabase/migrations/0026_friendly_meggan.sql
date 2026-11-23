CREATE TABLE "org_health_acknowledgement" (
	"id" text PRIMARY KEY NOT NULL,
	"position" bigint GENERATED ALWAYS AS IDENTITY (sequence name "org_health_acknowledgement_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"document" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_health_acknowledgement_position_unique" UNIQUE("position"),
	CONSTRAINT "org_health_acknowledgement_kind" CHECK (kind IN ('legacy-import', 'acknowledgement')),
	CONSTRAINT "org_health_acknowledgement_marker_shape" CHECK ((id = 'legacy-v1' AND kind = 'legacy-import' AND document IS NULL) OR (id <> 'legacy-v1' AND kind = 'acknowledgement' AND document IS NOT NULL AND jsonb_typeof(document) = 'object'))
);
--> statement-breakpoint
ALTER TABLE "org_health_acknowledgement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "org_health_incident" (
	"id" text PRIMARY KEY NOT NULL,
	"document" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_health_incident_is_singleton" CHECK (id = 'snapshot'),
	CONSTRAINT "org_health_incident_revision_positive" CHECK (revision > 0),
	CONSTRAINT "org_health_incident_is_object" CHECK (document IS NULL OR jsonb_typeof(document) = 'object')
);
--> statement-breakpoint
ALTER TABLE "org_health_incident" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "org_health_sighting" (
	"id" text PRIMARY KEY NOT NULL,
	"document" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_health_sighting_is_singleton" CHECK (id = 'sightings'),
	CONSTRAINT "org_health_sighting_revision_positive" CHECK (revision > 0),
	CONSTRAINT "org_health_sighting_is_object" CHECK (document IS NULL OR jsonb_typeof(document) = 'object')
);
--> statement-breakpoint
ALTER TABLE "org_health_sighting" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_health_acknowledgement_owner_all" ON "org_health_acknowledgement" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "org_health_acknowledgement_agent_read" ON "org_health_acknowledgement" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "org_health_acknowledgement_bot_read" ON "org_health_acknowledgement" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "org_health_incident_owner_all" ON "org_health_incident" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "org_health_incident_agent_read" ON "org_health_incident" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "org_health_incident_bot_read" ON "org_health_incident" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "org_health_sighting_owner_all" ON "org_health_sighting" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "org_health_sighting_agent_read" ON "org_health_sighting" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "org_health_sighting_bot_read" ON "org_health_sighting" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);