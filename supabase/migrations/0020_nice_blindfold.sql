CREATE TABLE "codex_fleet_cap" (
	"id" text PRIMARY KEY NOT NULL,
	"document" jsonb NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "codex_fleet_cap_is_singleton" CHECK (id = 'fleet'),
	CONSTRAINT "codex_fleet_cap_revision_positive" CHECK (revision > 0)
);
--> statement-breakpoint
ALTER TABLE "codex_fleet_cap" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "codex_fleet_cap_owner_all" ON "codex_fleet_cap" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "codex_fleet_cap_agent_read" ON "codex_fleet_cap" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "codex_fleet_cap_bot_read" ON "codex_fleet_cap" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);