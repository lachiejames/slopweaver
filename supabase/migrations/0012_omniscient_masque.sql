CREATE TABLE "codex_fallback_receipt" (
	"request_id" text PRIMARY KEY NOT NULL,
	"receipt_text" text NOT NULL,
	"receipt_sha256" text NOT NULL,
	"first_imported_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "codex_fallback_receipt_sha_shape" CHECK (receipt_sha256 ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "codex_fallback_receipt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "codex_fallback_request" (
	"request_id" text PRIMARY KEY NOT NULL,
	"request_text" text NOT NULL,
	"request_sha256" text NOT NULL,
	"mode" text,
	"pass" text,
	"repo_root" text,
	"branch" text,
	"created_at" timestamp (3) with time zone,
	"first_imported_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "codex_fallback_request_sha_shape" CHECK (request_sha256 ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "codex_fallback_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "codex_fallback_receipt" ADD CONSTRAINT "codex_fallback_receipt_request_id_codex_fallback_request_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."codex_fallback_request"("request_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_codex_fallback_request_branch_time" ON "codex_fallback_request" USING btree ("branch","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "codex_fallback_receipt_owner_all" ON "codex_fallback_receipt" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "codex_fallback_receipt_agent_read" ON "codex_fallback_receipt" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "codex_fallback_receipt_bot_read" ON "codex_fallback_receipt" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "codex_fallback_request_owner_all" ON "codex_fallback_request" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "codex_fallback_request_agent_read" ON "codex_fallback_request" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "codex_fallback_request_bot_read" ON "codex_fallback_request" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);