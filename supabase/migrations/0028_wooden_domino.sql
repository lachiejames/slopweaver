CREATE TABLE "singleton_register" (
	"id" text PRIMARY KEY NOT NULL,
	"document" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "singleton_register_known_id" CHECK (id in ('browser-profile', 'gmail-triage-rules', 'stale-seat-notices')),
	CONSTRAINT "singleton_register_revision_positive" CHECK (revision > 0)
);
--> statement-breakpoint
ALTER TABLE "singleton_register" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "singleton_register_owner_all" ON "singleton_register" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "singleton_register_agent_read" ON "singleton_register" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "singleton_register_bot_read" ON "singleton_register" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);