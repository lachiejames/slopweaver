CREATE TYPE "public"."recall_outcome" AS ENUM('held', 'broke', 'unchecked');--> statement-breakpoint
CREATE TABLE "memory_recalls" (
	"recall_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"memory_id" text NOT NULL,
	"recording_id" uuid NOT NULL,
	"outcome" "recall_outcome" NOT NULL,
	"evidence" text NOT NULL,
	"run" text NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_recalls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "idx_memory_recalls_memory_time" ON "memory_recalls" USING btree ("memory_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_memory_recalls_run_time" ON "memory_recalls" USING btree ("run","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "memory_recalls_owner_all" ON "memory_recalls" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "memory_recalls_agent_read" ON "memory_recalls" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "memory_recalls_bot_read" ON "memory_recalls" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);