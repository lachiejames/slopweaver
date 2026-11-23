CREATE TABLE "store_import_application" (
	"batch_id" uuid PRIMARY KEY NOT NULL,
	"plan_digest" text NOT NULL,
	"write_count" integer NOT NULL,
	"applied_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_import_application_plan_digest" CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "store_import_application_write_count" CHECK (write_count > 0)
);
--> statement-breakpoint
ALTER TABLE "store_import_application" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_import_part" (
	"batch_id" uuid NOT NULL,
	"part" text NOT NULL,
	CONSTRAINT "store_import_part_pk" PRIMARY KEY("batch_id","part"),
	CONSTRAINT "store_import_part_part" CHECK (part in ('memories', 'memory-recalls', 'owner-profile', 'owner-voice', 'owner-directives', 'standing-asks', 'steer-verdicts'))
);
--> statement-breakpoint
ALTER TABLE "store_import_part" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_import_batch" DROP CONSTRAINT "uq_store_import_batch_content";--> statement-breakpoint
-- Reordered by hand: the receipt's key below references this pair, which must exist first.
ALTER TABLE "store_import_batch" ADD CONSTRAINT "uq_store_import_batch_content_plan" UNIQUE("content_digest","plan_digest");--> statement-breakpoint
ALTER TABLE "store_import_batch" ADD CONSTRAINT "uq_store_import_batch_plan" UNIQUE("id","plan_digest");--> statement-breakpoint
ALTER TABLE "standing_ask" DROP CONSTRAINT "standing_ask_recorded_seq";--> statement-breakpoint
ALTER TABLE "store_import_question" DROP CONSTRAINT "store_import_question_kind";--> statement-breakpoint
ALTER TABLE "store_import_resolution" DROP CONSTRAINT "store_import_resolution_action";--> statement-breakpoint
ALTER TABLE "standing_ask" ALTER COLUMN "recorded_seq" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "store_import_application" ADD CONSTRAINT "fk_store_import_application_batch" FOREIGN KEY ("batch_id","plan_digest") REFERENCES "public"."store_import_batch"("id","plan_digest") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_import_part" ADD CONSTRAINT "store_import_part_batch_id_store_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."store_import_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Added by hand: a batch staged before part rows existed holds items and no part row, so each part its items name is
-- recorded before the key below would refuse them. An EMPTY part such a batch carried left no item, so it cannot be
-- recovered; an apply re-derives the batch's plan and refuses one whose parts no longer match.
INSERT INTO "store_import_part" ("batch_id", "part") SELECT DISTINCT "batch_id", "part" FROM "store_import_item";--> statement-breakpoint
ALTER TABLE "store_import_item" ADD CONSTRAINT "fk_store_import_item_part" FOREIGN KEY ("batch_id","part") REFERENCES "public"."store_import_part"("batch_id","part") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_correction" ADD CONSTRAINT "owner_correction_import_origin" CHECK ((origin = 'store-import') = (import_question_id is not null));--> statement-breakpoint
ALTER TABLE "owner_directive" ADD CONSTRAINT "owner_directive_import_origin" CHECK ((origin = 'store-import') = (import_question_id is not null));--> statement-breakpoint
ALTER TABLE "standing_ask" ADD CONSTRAINT "standing_ask_recorded_seq" CHECK ((state = 'inactive' and origin = 'store-import' and import_question_id is not null and recorded_seq is null) or (state <> 'inactive' and recorded_seq is not null and recorded_seq > 0));--> statement-breakpoint
ALTER TABLE "store_import_question" ADD CONSTRAINT "store_import_question_kind" CHECK ((kind = 'activation' and live_summary is null) or (kind in ('conflict', 'alignment') and live_summary is not null));--> statement-breakpoint
ALTER TABLE "store_import_resolution" ADD CONSTRAINT "store_import_resolution_action" CHECK ((question_kind = 'activation' and action in ('activate', 'leave-inactive')) or (question_kind = 'conflict' and action in ('keep-current', 'take-imported')) or (question_kind = 'alignment' and action = 'keep-current'));--> statement-breakpoint
CREATE POLICY "store_import_application_owner_all" ON "store_import_application" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "store_import_application_agent_read" ON "store_import_application" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "store_import_application_bot_read" ON "store_import_application" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "store_import_part_owner_all" ON "store_import_part" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "store_import_part_agent_read" ON "store_import_part" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "store_import_part_bot_read" ON "store_import_part" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);