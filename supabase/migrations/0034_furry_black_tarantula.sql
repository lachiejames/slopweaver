CREATE TYPE "public"."standing_ask_origin" AS ENUM('legacy-file', 'profile', 'store-import');--> statement-breakpoint
CREATE TYPE "public"."standing_ask_state" AS ENUM('active', 'inactive', 'withdrawn');--> statement-breakpoint
CREATE TABLE "standing_ask_coverage" (
	"ask_row_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"coverage" text NOT NULL,
	"state" "standing_ask_state" NOT NULL,
	CONSTRAINT "pk_standing_ask_coverage" PRIMARY KEY("ask_row_id","coverage"),
	CONSTRAINT "uq_standing_ask_coverage_ordinal" UNIQUE("ask_row_id","ordinal"),
	CONSTRAINT "standing_ask_coverage_ordinal" CHECK (ordinal >= 0),
	CONSTRAINT "standing_ask_coverage_kind" CHECK (coverage in ('findings', 'registered-rows', 'bot-replies', 'unlinked-cards') or coverage ~ '^act:[a-z0-9]+([-.][a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "standing_ask_coverage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "standing_ask_event" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_seq" bigint NOT NULL,
	"ask_row_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"origin" "standing_ask_origin" NOT NULL,
	"exact_line" text NOT NULL,
	"stored_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_standing_ask_event_seq" UNIQUE("journal_seq"),
	CONSTRAINT "standing_ask_event_seq" CHECK (journal_seq > 0),
	CONSTRAINT "standing_ask_event_kind" CHECK (kind in ('recorded', 'withdrawn')),
	CONSTRAINT "standing_ask_event_line" CHECK (exact_line <> '')
);
--> statement-breakpoint
ALTER TABLE "standing_ask_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "standing_ask" (
	"row_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ask_id" text NOT NULL,
	"state" "standing_ask_state" NOT NULL,
	"origin" "standing_ask_origin" NOT NULL,
	"quote_anchor" text NOT NULL,
	"quote_at" text NOT NULL,
	"quote_cut" text NOT NULL,
	"quote_where" text NOT NULL,
	"quote_words" text NOT NULL,
	"recorded_at" text NOT NULL,
	"recorded_seq" bigint NOT NULL,
	"import_question_id" text,
	CONSTRAINT "uq_standing_ask_recorded_seq" UNIQUE("recorded_seq"),
	CONSTRAINT "uq_standing_ask_import_question" UNIQUE("import_question_id"),
	CONSTRAINT "uq_standing_ask_row_state" UNIQUE("row_id","state"),
	CONSTRAINT "standing_ask_id" CHECK (ask_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "standing_ask_quote" CHECK (quote_anchor <> '' and quote_at <> '' and quote_words <> ''),
	CONSTRAINT "standing_ask_quote_cut" CHECK (quote_cut in ('none', 'start', 'end')),
	CONSTRAINT "standing_ask_quote_where" CHECK (quote_where in ('console-typed', 'console-voice', 'call', 'call-landing', 'session')),
	CONSTRAINT "standing_ask_recorded_at" CHECK (recorded_at <> ''),
	CONSTRAINT "standing_ask_recorded_seq" CHECK (recorded_seq > 0),
	CONSTRAINT "standing_ask_import_origin" CHECK ((origin = 'store-import') = (import_question_id is not null))
);
--> statement-breakpoint
ALTER TABLE "standing_ask" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "home_file_import" ADD COLUMN "source_sha256" text;--> statement-breakpoint
ALTER TABLE "home_file_import" ADD COLUMN "source_bytes" bigint;--> statement-breakpoint
ALTER TABLE "standing_ask_coverage" ADD CONSTRAINT "fk_standing_ask_coverage_ask" FOREIGN KEY ("ask_row_id","state") REFERENCES "public"."standing_ask"("row_id","state") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "standing_ask_event" ADD CONSTRAINT "standing_ask_event_ask_row_id_standing_ask_row_id_fk" FOREIGN KEY ("ask_row_id") REFERENCES "public"."standing_ask"("row_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_ask" ADD CONSTRAINT "standing_ask_import_question_id_store_import_question_id_fk" FOREIGN KEY ("import_question_id") REFERENCES "public"."store_import_question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_standing_ask_coverage_active" ON "standing_ask_coverage" USING btree ("coverage") WHERE state = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_standing_ask_active" ON "standing_ask" USING btree ("ask_id") WHERE state = 'active';--> statement-breakpoint
ALTER TABLE "home_file_import" ADD CONSTRAINT "home_file_import_witness_pair" CHECK ((source_sha256 is null) = (source_bytes is null));--> statement-breakpoint
ALTER TABLE "home_file_import" ADD CONSTRAINT "home_file_import_witness_shape" CHECK (source_sha256 is null or (source_sha256 ~ '^sha256:[0-9a-f]{64}$' and source_bytes >= 0));--> statement-breakpoint
ALTER TABLE "home_file_import" ADD CONSTRAINT "home_file_import_witness_present" CHECK (source_state = 'present' or source_sha256 is null);--> statement-breakpoint
ALTER TABLE "home_file_import" ADD CONSTRAINT "home_file_import_witness_required" CHECK (register not in ('standing-asks') or source_state = 'absent' or source_sha256 is not null);--> statement-breakpoint
CREATE POLICY "standing_ask_coverage_owner_all" ON "standing_ask_coverage" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "standing_ask_coverage_agent_read" ON "standing_ask_coverage" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "standing_ask_coverage_bot_read" ON "standing_ask_coverage" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "standing_ask_event_owner_all" ON "standing_ask_event" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "standing_ask_event_agent_read" ON "standing_ask_event" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "standing_ask_event_bot_read" ON "standing_ask_event" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "standing_ask_owner_all" ON "standing_ask" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "standing_ask_agent_read" ON "standing_ask" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "standing_ask_bot_read" ON "standing_ask" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);