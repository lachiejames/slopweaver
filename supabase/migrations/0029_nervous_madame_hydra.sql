CREATE TABLE "codex_supersession" (
	"artifact_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"property_id" text,
	"pass" text,
	"mode" text,
	"branch" text,
	"reason" text NOT NULL,
	"replaced_by" text NOT NULL,
	"at_iso" text NOT NULL,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "codex_supersession_kind" CHECK (kind in ('wording', 'no-tree')),
	CONSTRAINT "codex_supersession_mode" CHECK (mode is null or mode in ('plan', 'review')),
	CONSTRAINT "codex_supersession_wording_shape" CHECK (kind <> 'wording' or (property_id is not null and pass is null and mode is null and branch is null)),
	CONSTRAINT "codex_supersession_no_tree_shape" CHECK (kind <> 'no-tree' or (pass is not null and mode is not null and branch is not null))
);
--> statement-breakpoint
ALTER TABLE "codex_supersession" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "home_file_import" (
	"register" text PRIMARY KEY NOT NULL,
	"source_state" text NOT NULL,
	"records" integer NOT NULL,
	"imported_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "home_file_import_source_state" CHECK (source_state in ('absent', 'present')),
	CONSTRAINT "home_file_import_records_nonnegative" CHECK (records >= 0),
	CONSTRAINT "home_file_import_absent_is_empty" CHECK (source_state = 'present' or records = 0)
);
--> statement-breakpoint
ALTER TABLE "home_file_import" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "landing_press" (
	"press_key" text PRIMARY KEY NOT NULL,
	"ordinal" bigint GENERATED ALWAYS AS IDENTITY (sequence name "landing_press_ordinal_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"repo_slug" text NOT NULL,
	"number" integer NOT NULL,
	"head_oid" text NOT NULL,
	"entry_state" text NOT NULL,
	"at_iso" text NOT NULL,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "landing_press_ordinal_unique" UNIQUE("ordinal"),
	CONSTRAINT "landing_press_key_shape" CHECK (press_key ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "landing_press_number_positive" CHECK (number > 0),
	CONSTRAINT "landing_press_head_present" CHECK (head_oid <> ''),
	CONSTRAINT "landing_press_repo_present" CHECK (repo_slug <> '')
);
--> statement-breakpoint
ALTER TABLE "landing_press" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "landing_read_cursor" (
	"selection" text PRIMARY KEY NOT NULL,
	"at_iso" text NOT NULL,
	"rows" integer NOT NULL,
	"dispatchable" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "landing_read_cursor_rows_nonnegative" CHECK (rows >= 0),
	CONSTRAINT "landing_read_cursor_dispatchable_bounded" CHECK (dispatchable >= 0 and dispatchable <= rows),
	CONSTRAINT "landing_read_cursor_revision_positive" CHECK (revision > 0),
	CONSTRAINT "landing_read_cursor_selection_present" CHECK (selection <> '')
);
--> statement-breakpoint
ALTER TABLE "landing_read_cursor" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "idx_landing_press_subject" ON "landing_press" USING btree ("repo_slug","number","ordinal");--> statement-breakpoint
CREATE POLICY "codex_supersession_owner_all" ON "codex_supersession" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "codex_supersession_agent_read" ON "codex_supersession" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "codex_supersession_bot_read" ON "codex_supersession" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "home_file_import_owner_all" ON "home_file_import" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "home_file_import_agent_read" ON "home_file_import" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "home_file_import_bot_read" ON "home_file_import" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "landing_press_owner_all" ON "landing_press" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "landing_press_agent_read" ON "landing_press" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "landing_press_bot_read" ON "landing_press" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "landing_read_cursor_owner_all" ON "landing_read_cursor" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "landing_read_cursor_agent_read" ON "landing_read_cursor" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "landing_read_cursor_bot_read" ON "landing_read_cursor" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);