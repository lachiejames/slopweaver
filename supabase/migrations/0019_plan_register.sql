CREATE TABLE "plan_register" (
	"id" text PRIMARY KEY NOT NULL,
	"document" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_register_is_singleton" CHECK (id = 'plans'),
	CONSTRAINT "plan_register_revision_positive" CHECK (revision > 0)
);
--> statement-breakpoint
ALTER TABLE "plan_register" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "plan_register_owner_all" ON "plan_register" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "plan_register_agent_read" ON "plan_register" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "plan_register_bot_read" ON "plan_register" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);