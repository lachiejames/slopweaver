CREATE TABLE "authored_absent" (
	"relative_path" text PRIMARY KEY NOT NULL,
	"noticed_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "authored_absent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "authored_absent_owner_all" ON "authored_absent" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "authored_absent_agent_read" ON "authored_absent" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "authored_absent_bot_read" ON "authored_absent" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);