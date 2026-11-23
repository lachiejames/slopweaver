CREATE TABLE "fleet_config" (
	"id" text PRIMARY KEY NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"capacity" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_config_is_singleton" CHECK (id = 'fleet'),
	CONSTRAINT "fleet_config_schema_version" CHECK (schema_version = 1),
	CONSTRAINT "fleet_config_capacity_range" CHECK (capacity BETWEEN 1 AND 100),
	CONSTRAINT "fleet_config_revision_positive" CHECK (revision > 0)
);
--> statement-breakpoint
ALTER TABLE "fleet_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fleet_journal_event" (
	"journal" text NOT NULL,
	"sequence" bigint NOT NULL,
	"event" jsonb,
	"import_line" integer,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_journal_event_pk" PRIMARY KEY("journal","sequence"),
	CONSTRAINT "fleet_journal_event_sequence_positive" CHECK (sequence > 0),
	CONSTRAINT "fleet_journal_event_import_line_positive" CHECK (import_line IS NULL OR import_line > 0),
	CONSTRAINT "fleet_journal_event_placeholder_is_imported" CHECK (event IS NOT NULL OR import_line IS NOT NULL),
	CONSTRAINT "fleet_journal_event_is_object" CHECK (event IS NULL OR jsonb_typeof(event) = 'object')
);
--> statement-breakpoint
ALTER TABLE "fleet_journal_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fleet_journal" (
	"journal" text PRIMARY KEY NOT NULL,
	"latest_sequence" bigint DEFAULT 0 NOT NULL,
	"import_source" text NOT NULL,
	"import_unreadable" integer DEFAULT 0 NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_journal_name" CHECK (journal IN ('resume', 'cmux-revive')),
	CONSTRAINT "fleet_journal_import_source" CHECK (import_source IN ('absent', 'empty', 'present')),
	CONSTRAINT "fleet_journal_sequence_non_negative" CHECK (latest_sequence >= 0),
	CONSTRAINT "fleet_journal_unreadable_non_negative" CHECK (import_unreadable >= 0)
);
--> statement-breakpoint
ALTER TABLE "fleet_journal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fleet_journal_event" ADD CONSTRAINT "fleet_journal_event_journal_fleet_journal_journal_fk" FOREIGN KEY ("journal") REFERENCES "public"."fleet_journal"("journal") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "fleet_config_owner_all" ON "fleet_config" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "fleet_config_agent_read" ON "fleet_config" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "fleet_config_bot_read" ON "fleet_config" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);--> statement-breakpoint
CREATE POLICY "fleet_journal_event_owner_all" ON "fleet_journal_event" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "fleet_journal_event_agent_read" ON "fleet_journal_event" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "fleet_journal_event_bot_read" ON "fleet_journal_event" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "fleet_journal_owner_all" ON "fleet_journal" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "fleet_journal_agent_read" ON "fleet_journal" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "fleet_journal_bot_read" ON "fleet_journal" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);