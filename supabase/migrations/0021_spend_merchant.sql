CREATE TABLE "spend_merchant" (
	"slug" text PRIMARY KEY NOT NULL,
	"prefixes" text[] NOT NULL,
	"receipt_domains" text[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spend_merchant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "spend_merchant_owner_all" ON "spend_merchant" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "spend_merchant_agent_read" ON "spend_merchant" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "spend_merchant_bot_read" ON "spend_merchant" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);