CREATE TABLE "store_import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_digest" text NOT NULL,
	"plan_digest" text NOT NULL,
	"manifested" boolean NOT NULL,
	"staged_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_store_import_batch_content" UNIQUE("content_digest"),
	CONSTRAINT "store_import_batch_content_digest" CHECK (content_digest ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "store_import_batch_plan_digest" CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "store_import_batch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_import_item" (
	"batch_id" uuid NOT NULL,
	"part" text NOT NULL,
	"item_key" text NOT NULL,
	"ordinal" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"summary" text NOT NULL,
	CONSTRAINT "store_import_item_pk" PRIMARY KEY("batch_id","part","item_key"),
	CONSTRAINT "uq_store_import_item_ordinal" UNIQUE("batch_id","part","ordinal"),
	CONSTRAINT "store_import_item_part" CHECK (part in ('memories', 'memory-recalls', 'owner-profile', 'owner-voice', 'owner-directives', 'standing-asks', 'steer-verdicts')),
	CONSTRAINT "store_import_item_ordinal" CHECK (ordinal >= 0),
	CONSTRAINT "store_import_item_fingerprint" CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "store_import_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_import_question" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"part" text NOT NULL,
	"item_key" text NOT NULL,
	"kind" text NOT NULL,
	"imported_summary" text NOT NULL,
	"live_summary" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_store_import_question_item" UNIQUE("batch_id","part","item_key"),
	CONSTRAINT "uq_store_import_question_kind" UNIQUE("id","kind"),
	CONSTRAINT "store_import_question_id" CHECK (id ~ '^import-q-[0-9a-f]{16}$'),
	CONSTRAINT "store_import_question_kind" CHECK ((kind = 'activation' and live_summary is null) or (kind = 'conflict' and live_summary is not null))
);
--> statement-breakpoint
ALTER TABLE "store_import_question" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_import_resolution" (
	"question_id" text PRIMARY KEY NOT NULL,
	"question_kind" text NOT NULL,
	"action" text NOT NULL,
	"resolved_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_import_resolution_action" CHECK ((question_kind = 'activation' and action in ('activate', 'leave-inactive')) or (question_kind = 'conflict' and action in ('keep-current', 'take-imported')))
);
--> statement-breakpoint
ALTER TABLE "store_import_resolution" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_import_item" ADD CONSTRAINT "store_import_item_batch_id_store_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."store_import_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_import_question" ADD CONSTRAINT "fk_store_import_question_item" FOREIGN KEY ("batch_id","part","item_key") REFERENCES "public"."store_import_item"("batch_id","part","item_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_import_resolution" ADD CONSTRAINT "fk_store_import_resolution_question" FOREIGN KEY ("question_id","question_kind") REFERENCES "public"."store_import_question"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "store_import_batch_owner_all" ON "store_import_batch" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "store_import_batch_agent_read" ON "store_import_batch" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "store_import_batch_bot_read" ON "store_import_batch" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "store_import_item_owner_all" ON "store_import_item" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "store_import_item_agent_read" ON "store_import_item" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "store_import_item_bot_read" ON "store_import_item" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "store_import_question_owner_all" ON "store_import_question" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "store_import_question_agent_read" ON "store_import_question" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "store_import_question_bot_read" ON "store_import_question" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "store_import_resolution_owner_all" ON "store_import_resolution" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "store_import_resolution_agent_read" ON "store_import_resolution" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "store_import_resolution_bot_read" ON "store_import_resolution" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);