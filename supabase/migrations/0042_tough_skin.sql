CREATE TYPE "public"."workstream_entry_kind" AS ENUM('raised', 'discussion', 'dm', 'proposal', 'pr', 'pushback', 'announce', 'note');--> statement-breakpoint
CREATE TYPE "public"."workstream_kind" AS ENUM('outcome', 'standing', 'linked', 'local', 'closing');--> statement-breakpoint
CREATE TYPE "public"."workstream_link_kind" AS ENUM('queue_card', 'alignment_card', 'automation', 'pull_request', 'linear_project', 'workstream');--> statement-breakpoint
CREATE TYPE "public"."workstream_status" AS ENUM('proven', 'validating', 'stalled', 'discovery');--> statement-breakpoint
CREATE TYPE "public"."workstream_workspace" AS ENUM('team', 'self');--> statement-breakpoint
CREATE TABLE "workstream_entry" (
	"id" uuid NOT NULL,
	"workstream_id" text NOT NULL,
	"date" date NOT NULL,
	"kind" "workstream_entry_kind" NOT NULL,
	"text" text NOT NULL,
	"href" text,
	"milestone_id" text,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "pk_workstream_entry" PRIMARY KEY("workstream_id","id"),
	CONSTRAINT "uq_workstream_entry_position" UNIQUE("workstream_id","position"),
	CONSTRAINT "workstream_entry_text_present" CHECK (text <> ''),
	CONSTRAINT "workstream_entry_position" CHECK (position >= 0),
	CONSTRAINT "workstream_entry_done_proven" CHECK (not done or (milestone_id is not null and href is not null))
);
--> statement-breakpoint
ALTER TABLE "workstream_entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workstream_link" (
	"id" uuid NOT NULL,
	"workstream_id" text NOT NULL,
	"kind" "workstream_link_kind" NOT NULL,
	"target" text NOT NULL,
	"label" text,
	"milestone_id" text,
	CONSTRAINT "pk_workstream_link" PRIMARY KEY("workstream_id","id"),
	CONSTRAINT "uq_workstream_link_target" UNIQUE("workstream_id","kind","target"),
	CONSTRAINT "workstream_link_target_present" CHECK (target <> '' and (label is null or label <> ''))
);
--> statement-breakpoint
ALTER TABLE "workstream_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workstream_milestone_after" (
	"workstream_id" text NOT NULL,
	"milestone_id" text NOT NULL,
	"after_id" text NOT NULL,
	CONSTRAINT "pk_workstream_milestone_after" PRIMARY KEY("workstream_id","milestone_id","after_id"),
	CONSTRAINT "workstream_milestone_after_not_self" CHECK (milestone_id <> after_id)
);
--> statement-breakpoint
ALTER TABLE "workstream_milestone_after" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workstream_milestone" (
	"workstream_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"anchor" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "pk_workstream_milestone" PRIMARY KEY("workstream_id","id"),
	CONSTRAINT "uq_workstream_milestone_position" UNIQUE("workstream_id","position"),
	CONSTRAINT "workstream_milestone_id_kebab" CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "workstream_milestone_name_present" CHECK (name <> '' and anchor <> ''),
	CONSTRAINT "workstream_milestone_position" CHECK (position >= 0)
);
--> statement-breakpoint
ALTER TABLE "workstream_milestone" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workstream_register_meta" (
	"id" text PRIMARY KEY NOT NULL,
	"document" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workstream_register_meta_is_singleton" CHECK (id = 'workstreams'),
	CONSTRAINT "workstream_register_meta_revision_positive" CHECK (revision > 0)
);
--> statement-breakpoint
ALTER TABLE "workstream_register_meta" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workstream" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "workstream_kind" NOT NULL,
	"workspace" "workstream_workspace" NOT NULL,
	"outcome" text,
	"status" "workstream_status",
	"detail" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workstream_id_kebab" CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "workstream_name_present" CHECK (name <> ''),
	CONSTRAINT "workstream_revision_positive" CHECK (revision > 0),
	CONSTRAINT "workstream_kind_columns" CHECK ((kind in ('outcome', 'standing') and outcome is not null and status is not null) or (kind = 'linked' and outcome is not null and status is null) or (kind = 'local' and outcome is null and status is null) or (kind = 'closing' and status is null))
);
--> statement-breakpoint
ALTER TABLE "workstream" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workstream_entry" ADD CONSTRAINT "workstream_entry_workstream_id_workstream_id_fk" FOREIGN KEY ("workstream_id") REFERENCES "public"."workstream"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstream_entry" ADD CONSTRAINT "fk_workstream_entry_milestone" FOREIGN KEY ("workstream_id","milestone_id") REFERENCES "public"."workstream_milestone"("workstream_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstream_link" ADD CONSTRAINT "workstream_link_workstream_id_workstream_id_fk" FOREIGN KEY ("workstream_id") REFERENCES "public"."workstream"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstream_link" ADD CONSTRAINT "fk_workstream_link_milestone" FOREIGN KEY ("workstream_id","milestone_id") REFERENCES "public"."workstream_milestone"("workstream_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstream_milestone_after" ADD CONSTRAINT "fk_workstream_milestone_after_milestone" FOREIGN KEY ("workstream_id","milestone_id") REFERENCES "public"."workstream_milestone"("workstream_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstream_milestone_after" ADD CONSTRAINT "fk_workstream_milestone_after_after" FOREIGN KEY ("workstream_id","after_id") REFERENCES "public"."workstream_milestone"("workstream_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstream_milestone" ADD CONSTRAINT "workstream_milestone_workstream_id_workstream_id_fk" FOREIGN KEY ("workstream_id") REFERENCES "public"."workstream"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "workstream_entry_owner_all" ON "workstream_entry" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "workstream_entry_agent_read" ON "workstream_entry" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "workstream_entry_bot_read" ON "workstream_entry" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "workstream_link_owner_all" ON "workstream_link" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "workstream_link_agent_read" ON "workstream_link" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "workstream_link_bot_read" ON "workstream_link" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "workstream_milestone_after_owner_all" ON "workstream_milestone_after" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "workstream_milestone_after_agent_read" ON "workstream_milestone_after" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "workstream_milestone_after_bot_read" ON "workstream_milestone_after" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "workstream_milestone_owner_all" ON "workstream_milestone" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "workstream_milestone_agent_read" ON "workstream_milestone" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "workstream_milestone_bot_read" ON "workstream_milestone" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "workstream_register_meta_owner_all" ON "workstream_register_meta" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "workstream_register_meta_agent_read" ON "workstream_register_meta" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "workstream_register_meta_bot_read" ON "workstream_register_meta" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "workstream_owner_all" ON "workstream" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "workstream_agent_read" ON "workstream" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "workstream_bot_read" ON "workstream" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);