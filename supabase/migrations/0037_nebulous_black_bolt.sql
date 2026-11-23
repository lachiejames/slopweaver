CREATE TABLE "knowledge_domain" (
	"slug" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"holds" text,
	"folds_into" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_domain_kind" CHECK (kind in ('domain', 'alias')),
	CONSTRAINT "knowledge_domain_slug_shape" CHECK (length(slug) between 2 and 40 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "knowledge_domain_row_shape" CHECK ((kind = 'domain' and holds is not null and btrim(holds) <> '' and folds_into is null) or (kind = 'alias' and holds is null and folds_into is not null))
);
--> statement-breakpoint
ALTER TABLE "knowledge_domain" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "knowledge_domain_owner_all" ON "knowledge_domain" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "knowledge_domain_agent_read" ON "knowledge_domain" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "knowledge_domain_bot_read" ON "knowledge_domain" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);