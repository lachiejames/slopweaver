CREATE TABLE "codex_sign_in_observation" (
	"alias" text PRIMARY KEY NOT NULL,
	"record" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "codex_sign_in_observation_revision_positive" CHECK (revision > 0)
);
--> statement-breakpoint
ALTER TABLE "codex_sign_in_observation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "codex_sign_in_observation_owner_all" ON "codex_sign_in_observation" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "codex_sign_in_observation_agent_read" ON "codex_sign_in_observation" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "codex_sign_in_observation_bot_read" ON "codex_sign_in_observation" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);