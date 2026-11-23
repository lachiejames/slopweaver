CREATE TABLE "organisation" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"github_owner" text NOT NULL,
	"google_domain" text,
	"slack_hosts" text[] NOT NULL,
	"linear_workspace" text,
	"vanta_workspace" text,
	"repositories" text[] NOT NULL,
	"dependency_bots" text[] NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_is_singleton" CHECK (id = 'organisation')
);
--> statement-breakpoint
ALTER TABLE "organisation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "organisation_owner_all" ON "organisation" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "organisation_agent_read" ON "organisation" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "organisation_bot_read" ON "organisation" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);