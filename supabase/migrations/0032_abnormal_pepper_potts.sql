CREATE TYPE "public"."judgement_instruction_state" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."owner_judgement_origin" AS ENUM('legacy-file', 'memory', 'store-import');--> statement-breakpoint
CREATE TABLE "owner_correction" (
	"row_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"correction_id" text NOT NULL,
	"state" "judgement_instruction_state" NOT NULL,
	"origin" "owner_judgement_origin" NOT NULL,
	"text" text NOT NULL,
	"source_file" text NOT NULL,
	"source_content_hash" text NOT NULL,
	"source_modified" text,
	"subject_source" text NOT NULL,
	"subject_container" text NOT NULL,
	"subject_source_id" text NOT NULL,
	"subject_url" text,
	"import_question_id" text,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_owner_correction_import_question" UNIQUE("import_question_id"),
	CONSTRAINT "owner_correction_id" CHECK (correction_id <> ''),
	CONSTRAINT "owner_correction_text" CHECK (text <> ''),
	CONSTRAINT "owner_correction_subject" CHECK (subject_source <> '' and subject_container <> '' and subject_source_id <> ''),
	CONSTRAINT "owner_correction_source_hash" CHECK (source_content_hash ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "owner_correction" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "owner_directive" (
	"row_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"directive_id" text NOT NULL,
	"state" "judgement_instruction_state" NOT NULL,
	"origin" "owner_judgement_origin" NOT NULL,
	"text" text NOT NULL,
	"source_file" text NOT NULL,
	"source_content_hash" text NOT NULL,
	"source_modified" text,
	"import_question_id" text,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_owner_directive_import_question" UNIQUE("import_question_id"),
	CONSTRAINT "owner_directive_id" CHECK (directive_id <> ''),
	CONSTRAINT "owner_directive_text" CHECK (text <> ''),
	CONSTRAINT "owner_directive_source_hash" CHECK (source_content_hash ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "owner_directive" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "owner_correction" ADD CONSTRAINT "owner_correction_import_question_id_store_import_question_id_fk" FOREIGN KEY ("import_question_id") REFERENCES "public"."store_import_question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_directive" ADD CONSTRAINT "owner_directive_import_question_id_store_import_question_id_fk" FOREIGN KEY ("import_question_id") REFERENCES "public"."store_import_question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_owner_correction_active" ON "owner_correction" USING btree ("correction_id") WHERE state = 'active';--> statement-breakpoint
CREATE INDEX "idx_owner_correction_state" ON "owner_correction" USING btree ("state","correction_id");--> statement-breakpoint
CREATE INDEX "idx_owner_correction_subject" ON "owner_correction" USING btree ("subject_source","subject_container","subject_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_owner_directive_active" ON "owner_directive" USING btree ("directive_id") WHERE state = 'active';--> statement-breakpoint
CREATE INDEX "idx_owner_directive_state" ON "owner_directive" USING btree ("state","directive_id");--> statement-breakpoint
CREATE POLICY "owner_correction_owner_all" ON "owner_correction" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "owner_correction_agent_read" ON "owner_correction" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "owner_correction_bot_read" ON "owner_correction" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "owner_directive_owner_all" ON "owner_directive" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "owner_directive_agent_read" ON "owner_directive" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "owner_directive_bot_read" ON "owner_directive" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);