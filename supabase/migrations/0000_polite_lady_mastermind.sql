CREATE TYPE "public"."container_kind" AS ENUM('channel', 'repository', 'project', 'team', 'database', 'workspace', 'mailbox', 'calendar', 'directory', 'recorder');--> statement-breakpoint
CREATE TYPE "public"."content_kind" AS ENUM('pr', 'issue', 'comment', 'review', 'finding', 'message', 'file', 'page', 'database', 'status', 'project', 'initiative', 'document', 'update', 'canvas', 'bookmark', 'pin', 'discussion', 'release', 'milestone', 'codeowners', 'need', 'huddle', 'transcript', 'event');--> statement-breakpoint
CREATE TYPE "public"."content_source" AS ENUM('github', 'slack', 'linear', 'notion', 'self', 'gmail', 'calendar', 'fathom');--> statement-breakpoint
CREATE TYPE "public"."person_link_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."memory_kind" AS ENUM('lesson', 'preference');--> statement-breakpoint
CREATE TYPE "public"."memory_surface" AS ENUM('api', 'browser', 'cli', 'repo', 'process');--> statement-breakpoint
CREATE TYPE "public"."memory_verdict" AS ENUM('confirmed', 'changed', 'refuted', 'untestable', 'unsettled');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TABLE "container" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "content_source" NOT NULL,
	"native_id" text NOT NULL,
	"kind" "container_kind" NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "container" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "content_github" (
	"content_id" uuid PRIMARY KEY NOT NULL,
	"source" "content_source" DEFAULT 'github' NOT NULL,
	"repo" text NOT NULL,
	"number" integer,
	"state" text,
	"is_draft" boolean,
	"review_decision" text,
	"author_association" text,
	"closed_at" timestamp with time zone,
	"labels" text[] DEFAULT '{}' NOT NULL,
	"assignees" text[] DEFAULT '{}' NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "content_github_is_github" CHECK (source = 'github')
);
--> statement-breakpoint
ALTER TABLE "content_github" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "content_linear" (
	"content_id" uuid PRIMARY KEY NOT NULL,
	"source" "content_source" DEFAULT 'linear' NOT NULL,
	"team" text NOT NULL,
	"identifier" text,
	"number" integer,
	"state" text,
	"state_type" text,
	"priority" integer,
	"priority_label" text,
	"assignee" text,
	"project" text,
	"cycle" text,
	"estimate" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"labels" text[] DEFAULT '{}' NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "content_linear_is_linear" CHECK (source = 'linear')
);
--> statement-breakpoint
ALTER TABLE "content_linear" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "content_notion" (
	"content_id" uuid PRIMARY KEY NOT NULL,
	"source" "content_source" DEFAULT 'notion' NOT NULL,
	"parent_kind" text,
	"parent_id" text,
	"icon" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"last_edited_at" timestamp with time zone,
	"chunk_index" integer,
	"chunk_count" integer,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "content_notion_is_notion" CHECK (source = 'notion')
);
--> statement-breakpoint
ALTER TABLE "content_notion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "content_slack" (
	"content_id" uuid PRIMARY KEY NOT NULL,
	"source" "content_source" DEFAULT 'slack' NOT NULL,
	"channel_id" text NOT NULL,
	"channel_name" text,
	"message_ts" text NOT NULL,
	"thread_ts" text,
	"subtype" text,
	"bot_id" text,
	"app_id" text,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"reaction_count" integer DEFAULT 0 NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "content_slack_is_slack" CHECK (source = 'slack')
);
--> statement-breakpoint
ALTER TABLE "content_slack" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "content_source" NOT NULL,
	"source_id" text NOT NULL,
	"kind" "content_kind" NOT NULL,
	"url" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"container_id" uuid,
	"author_id" uuid,
	"title" text,
	"body" text NOT NULL,
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"searchable" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || body)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_content_id_source" UNIQUE("id","source")
);
--> statement-breakpoint
ALTER TABLE "content" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "memories" (
	"recording_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"id" text NOT NULL,
	"kind" "memory_kind" NOT NULL,
	"domain" text NOT NULL,
	"claim" text NOT NULL,
	"evidence" text NOT NULL,
	"verdict" "memory_verdict" NOT NULL,
	"tier" smallint,
	"surface" "memory_surface",
	"repro" text,
	"caveat" text,
	"learner" text,
	"behaviour_change" text,
	"retrieval_cue" text,
	"run" text NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	"import_key" text,
	"searchable" "tsvector" GENERATED ALWAYS AS (to_tsvector(
        'english',
        domain || ' ' || claim || ' ' || evidence || ' ' || coalesce(caveat, '') || ' ' ||
          coalesce(behaviour_change, '') || ' ' || coalesce(retrieval_cue, '')
      )) STORED,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memories_lesson_facets" CHECK ((kind = 'lesson' and tier is not null and surface is not null)
        or (kind = 'preference' and tier is null and surface is null and repro is null)),
	CONSTRAINT "memories_tier_range" CHECK (tier is null or (tier >= 1 and tier <= 4))
);
--> statement-breakpoint
ALTER TABLE "memories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "person_link_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"source" "content_source" NOT NULL,
	"native_id" text NOT NULL,
	"handle" text,
	"confidence" numeric(4, 3) NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "person_link_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "person_link_candidate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"identities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "container" ADD CONSTRAINT "container_parent_id_container_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."container"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_github" ADD CONSTRAINT "fk_content_github_content" FOREIGN KEY ("content_id","source") REFERENCES "public"."content"("id","source") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_linear" ADD CONSTRAINT "fk_content_linear_content" FOREIGN KEY ("content_id","source") REFERENCES "public"."content"("id","source") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_notion" ADD CONSTRAINT "fk_content_notion_content" FOREIGN KEY ("content_id","source") REFERENCES "public"."content"("id","source") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_slack" ADD CONSTRAINT "fk_content_slack_content" FOREIGN KEY ("content_id","source") REFERENCES "public"."content"("id","source") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_container_id_container_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."container"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_author_id_person_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_link_candidate" ADD CONSTRAINT "person_link_candidate_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_container_source_native" ON "container" USING btree ("source","native_id");--> statement-breakpoint
CREATE INDEX "idx_container_parent" ON "container" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_container_source_kind" ON "container" USING btree ("source","kind");--> statement-breakpoint
CREATE INDEX "idx_github_repo_number" ON "content_github" USING btree ("repo","number");--> statement-breakpoint
CREATE INDEX "idx_github_state" ON "content_github" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_github_labels" ON "content_github" USING gin ("labels");--> statement-breakpoint
CREATE INDEX "idx_linear_team_state" ON "content_linear" USING btree ("team","state_type");--> statement-breakpoint
CREATE INDEX "idx_linear_identifier" ON "content_linear" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "idx_linear_assignee" ON "content_linear" USING btree ("assignee");--> statement-breakpoint
CREATE INDEX "idx_linear_labels" ON "content_linear" USING gin ("labels");--> statement-breakpoint
CREATE INDEX "idx_notion_parent" ON "content_notion" USING btree ("parent_kind","parent_id");--> statement-breakpoint
CREATE INDEX "idx_notion_properties" ON "content_notion" USING gin ("properties");--> statement-breakpoint
CREATE INDEX "idx_slack_channel" ON "content_slack" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_slack_thread" ON "content_slack" USING btree ("thread_ts");--> statement-breakpoint
CREATE INDEX "idx_slack_bot" ON "content_slack" USING btree ("is_bot");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_content_source_native" ON "content" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "idx_content_source_time" ON "content" USING btree ("source","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_content_container_time" ON "content" USING btree ("container_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_content_author" ON "content" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "idx_content_kind" ON "content" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_content_search" ON "content" USING gin ("searchable");--> statement-breakpoint
CREATE INDEX "idx_content_body_trgm" ON "content" USING gin ("body" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_content_title_trgm" ON "content" USING gin ((coalesce("title", '')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_memories_search" ON "memories" USING gin ("searchable");--> statement-breakpoint
CREATE INDEX "idx_memories_claim_time" ON "memories" USING btree ("id","recorded_at" DESC NULLS LAST,"seq" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_memories_seq" ON "memories" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "idx_memories_domain_time" ON "memories" USING btree ("domain","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_memories_learner_time" ON "memories" USING btree ("learner","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_memories_run_time" ON "memories" USING btree ("run","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_memories_import_key" ON "memories" USING btree ("import_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_link_candidate" ON "person_link_candidate" USING btree ("person_id","source","native_id");--> statement-breakpoint
CREATE INDEX "idx_link_candidate_status" ON "person_link_candidate" USING btree ("status","confidence" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_person_identities" ON "person" USING gin ("identities");--> statement-breakpoint
CREATE INDEX "idx_person_display_name" ON "person" USING btree ("display_name");--> statement-breakpoint
CREATE POLICY "container_owner_all" ON "container" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "container_agent_read" ON "container" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "container_bot_read" ON "container" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);--> statement-breakpoint
CREATE POLICY "content_github_owner_all" ON "content_github" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "content_github_agent_read" ON "content_github" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "content_github_bot_read" ON "content_github" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);--> statement-breakpoint
CREATE POLICY "content_linear_owner_all" ON "content_linear" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "content_linear_agent_read" ON "content_linear" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "content_linear_bot_read" ON "content_linear" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);--> statement-breakpoint
CREATE POLICY "content_notion_owner_all" ON "content_notion" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "content_notion_agent_read" ON "content_notion" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "content_notion_bot_read" ON "content_notion" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);--> statement-breakpoint
CREATE POLICY "content_slack_owner_all" ON "content_slack" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "content_slack_agent_read" ON "content_slack" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "content_slack_bot_read" ON "content_slack" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);--> statement-breakpoint
CREATE POLICY "content_owner_all" ON "content" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "content_agent_read" ON "content" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "content_bot_read" ON "content" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (visibility = 'public');--> statement-breakpoint
CREATE POLICY "memories_owner_all" ON "memories" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "memories_agent_read" ON "memories" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "memories_bot_read" ON "memories" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "person_link_candidate_owner_all" ON "person_link_candidate" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "person_link_candidate_agent_read" ON "person_link_candidate" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "person_link_candidate_bot_read" ON "person_link_candidate" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);--> statement-breakpoint
CREATE POLICY "person_owner_all" ON "person" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "person_agent_read" ON "person" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "person_bot_read" ON "person" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);