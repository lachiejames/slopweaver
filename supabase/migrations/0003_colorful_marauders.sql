CREATE TYPE "public"."autonomy_entry" AS ENUM('action', 'steer');--> statement-breakpoint
CREATE TYPE "public"."board_kind" AS ENUM('doc', 'ask', 'tag');--> statement-breakpoint
CREATE TYPE "public"."board_origin" AS ENUM('finding');--> statement-breakpoint
CREATE TYPE "public"."board_priority" AS ENUM('p0', 'p1', 'p2', 'p3');--> statement-breakpoint
CREATE TYPE "public"."board_settlement" AS ENUM('filed', 'answered', 'declined');--> statement-breakpoint
CREATE TYPE "public"."board_status" AS ENUM('draft', 'ready', 'in-progress', 'paused', 'done', 'cancelled', 'rejected', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."door_provenance" AS ENUM('attributed', 'unattributable');--> statement-breakpoint
CREATE TYPE "public"."run_phase" AS ENUM('open', 'waiting-on-owner', 'closed');--> statement-breakpoint
CREATE TABLE "autonomy_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_id" text NOT NULL,
	"entry_kind" "autonomy_entry" NOT NULL,
	"kind" text,
	"subject" text,
	"why" text,
	"witness" text,
	"steer" text,
	"run" text,
	"by_session" text,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"import_key" text NOT NULL,
	CONSTRAINT "autonomy_event_entry_fields" CHECK ((entry_kind = 'action' and kind is not null and subject is not null
            and why is not null and witness is not null)
        or (entry_kind = 'steer' and steer is not null and why is null and witness is null))
);
--> statement-breakpoint
ALTER TABLE "autonomy_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "board_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"kind" "board_kind" NOT NULL,
	"status" "board_status" NOT NULL,
	"priority" "board_priority",
	"summary" text,
	"repo" text,
	"branch" text,
	"base_branch" text,
	"asked_at" timestamp (3) with time zone,
	"anchor" text,
	"settlement" "board_settlement",
	"settlement_witness" text,
	"settlement_reason" text,
	"origin" "board_origin",
	"observed_by" text,
	"ruling" text,
	"ruling_anchor" text,
	"paused_on" text,
	"paused_since" timestamp (3) with time zone,
	"blocked_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"done_when" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_path" text NOT NULL,
	"doc_hash" text NOT NULL,
	"imported_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"searchable" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', slug || ' ' || coalesce(summary, ''))) STORED
);
--> statement-breakpoint
ALTER TABLE "board_row" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "codex_pass" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pass" text,
	"mode" text,
	"property_id" text,
	"property" text,
	"outcome" text NOT NULL,
	"model" text,
	"branch" text,
	"head_sha" text,
	"base_sha" text,
	"diff_sha256" text,
	"repo_root" text,
	"elapsed_ms" integer,
	"created_at" timestamp (3) with time zone NOT NULL,
	"artifact" text,
	"record" jsonb NOT NULL,
	"searchable" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(property, '') || ' ' || coalesce(artifact, ''))) STORED
);
--> statement-breakpoint
ALTER TABLE "codex_pass" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "door_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"effect" text NOT NULL,
	"status" text NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"overridden" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"door_run_id" text,
	"duplicate_key" text,
	"acknowledgement" jsonb,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"provenance" "door_provenance" NOT NULL,
	"import_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "door_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "grant_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" text NOT NULL,
	"entry_kind" text NOT NULL,
	"target_file" text,
	"change_kind" text,
	"change" text,
	"anchor" text,
	"refusal_code" text,
	"detail" text,
	"by_session" text,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	"entry" jsonb NOT NULL,
	"import_key" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grant_row" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "run_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"kind" text NOT NULL,
	"at_iso" timestamp (3) with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"searchable" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', kind || ' ' || coalesce(payload::text, ''))) STORED
);
--> statement-breakpoint
ALTER TABLE "run_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"phase" "run_phase" NOT NULL,
	"branch" text,
	"writer_session" text,
	"doc_hash" text,
	"first_event_at" timestamp (3) with time zone NOT NULL,
	"last_event_at" timestamp (3) with time zone NOT NULL,
	"event_count" integer NOT NULL,
	"derived_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"source_path" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "run_event" ADD CONSTRAINT "run_event_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_autonomy_event_import_key" ON "autonomy_event" USING btree ("import_key");--> statement-breakpoint
CREATE INDEX "idx_autonomy_event_time" ON "autonomy_event" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_autonomy_event_kind_time" ON "autonomy_event" USING btree ("kind","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_autonomy_event_subject" ON "autonomy_event" USING btree ("subject");--> statement-breakpoint
CREATE INDEX "idx_autonomy_event_action" ON "autonomy_event" USING btree ("action_id","entry_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_board_row_slug" ON "board_row" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_board_row_search" ON "board_row" USING gin ("searchable");--> statement-breakpoint
CREATE INDEX "idx_board_row_status_priority" ON "board_row" USING btree ("status","priority");--> statement-breakpoint
CREATE INDEX "idx_board_row_kind_asked" ON "board_row" USING btree ("kind","asked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_board_row_origin_settlement" ON "board_row" USING btree ("origin","settlement");--> statement-breakpoint
CREATE INDEX "idx_codex_pass_search" ON "codex_pass" USING gin ("searchable");--> statement-breakpoint
CREATE INDEX "idx_codex_pass_branch_time" ON "codex_pass" USING btree ("branch","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_codex_pass_outcome_time" ON "codex_pass" USING btree ("outcome","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_door_event_import_key" ON "door_event" USING btree ("import_key");--> statement-breakpoint
CREATE INDEX "idx_door_event_provenance_time" ON "door_event" USING btree ("provenance","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_door_event_action_time" ON "door_event" USING btree ("action","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_door_event_status" ON "door_event" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_door_event_duplicate_key" ON "door_event" USING btree ("duplicate_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_grant_row_import_key" ON "grant_row" USING btree ("import_key");--> statement-breakpoint
CREATE INDEX "idx_grant_row_grant_time" ON "grant_row" USING btree ("grant_id","recorded_at");--> statement-breakpoint
CREATE INDEX "idx_grant_row_kind_time" ON "grant_row" USING btree ("entry_kind","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_run_event_line" ON "run_event" USING btree ("run_id","line_number");--> statement-breakpoint
CREATE INDEX "idx_run_event_run_time" ON "run_event" USING btree ("run_id","at_iso");--> statement-breakpoint
CREATE INDEX "idx_run_event_kind_time" ON "run_event" USING btree ("kind","at_iso" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_run_event_search" ON "run_event" USING gin ("searchable");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_run_slug" ON "run" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_run_phase_last" ON "run" USING btree ("phase","last_event_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_run_writer" ON "run" USING btree ("writer_session");--> statement-breakpoint
CREATE POLICY "autonomy_event_owner_all" ON "autonomy_event" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "autonomy_event_agent_read" ON "autonomy_event" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "autonomy_event_bot_read" ON "autonomy_event" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "board_row_owner_all" ON "board_row" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "board_row_agent_read" ON "board_row" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "board_row_bot_read" ON "board_row" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "codex_pass_owner_all" ON "codex_pass" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "codex_pass_agent_read" ON "codex_pass" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "codex_pass_bot_read" ON "codex_pass" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "door_event_owner_all" ON "door_event" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "door_event_agent_read" ON "door_event" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "door_event_bot_read" ON "door_event" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "grant_row_owner_all" ON "grant_row" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "grant_row_agent_read" ON "grant_row" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "grant_row_bot_read" ON "grant_row" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "run_event_owner_all" ON "run_event" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "run_event_agent_read" ON "run_event" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "run_event_bot_read" ON "run_event" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "run_owner_all" ON "run" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "run_agent_read" ON "run" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "run_bot_read" ON "run" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);