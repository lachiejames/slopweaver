CREATE TYPE "public"."atlas_coverage_state" AS ENUM('synced', 'held-elsewhere', 'deferred', 'not-configured', 'invalid-configuration', 'unreadable', 'unavailable', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."atlas_entity_state" AS ENUM('observed', 'stale');--> statement-breakpoint
CREATE TYPE "public"."atlas_evidence_role" AS ENUM('authoritative', 'corroborating', 'discovery');--> statement-breakpoint
CREATE TABLE "atlas_coverage" (
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"scope" text NOT NULL,
	"surface" text,
	"state" "atlas_coverage_state" NOT NULL,
	"role" "atlas_evidence_role",
	"reason" text NOT NULL,
	"last_success_at" timestamp (3) with time zone,
	"latest_attempt_failed" boolean NOT NULL,
	"unblocked_by" text,
	"visibility_scope" text,
	"artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"loaded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_atlas_coverage" UNIQUE NULLS NOT DISTINCT("platform","kind","scope","surface")
);
--> statement-breakpoint
ALTER TABLE "atlas_coverage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "atlas_entity_channel" (
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"channel" text NOT NULL,
	"state" "atlas_entity_state" NOT NULL,
	"first_seen_at" timestamp (3) with time zone NOT NULL,
	"last_seen_at" timestamp (3) with time zone NOT NULL,
	"observed_at" timestamp (3) with time zone,
	"endpoint" text,
	"surface" text,
	"deep_link" text,
	"deep_link_status" text,
	"artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detail" jsonb,
	CONSTRAINT "uq_atlas_entity_channel" UNIQUE("platform","kind","entity_id","channel")
);
--> statement-breakpoint
ALTER TABLE "atlas_entity_channel" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "atlas_entity" (
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generation_at" timestamp (3) with time zone NOT NULL,
	"loaded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_atlas_entity" UNIQUE("platform","kind","entity_id")
);
--> statement-breakpoint
ALTER TABLE "atlas_entity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "atlas_gap" (
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"gap_id" text NOT NULL,
	"condition" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"scope" text NOT NULL,
	"fields" text[] DEFAULT '{}' NOT NULL,
	"surfaces" text[] DEFAULT '{}' NOT NULL,
	"first_detected_at" timestamp (3) with time zone NOT NULL,
	"last_detected_at" timestamp (3) with time zone NOT NULL,
	"last_checked_at" timestamp (3) with time zone,
	"loaded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_atlas_gap" UNIQUE("platform","kind","gap_id")
);
--> statement-breakpoint
ALTER TABLE "atlas_gap" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "atlas_kind_status" (
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"digest" text,
	"entity_count" integer NOT NULL,
	"schema_version" integer,
	"read_epoch" text,
	"last_attempt_at" timestamp (3) with time zone,
	"last_attempt_outcome" text,
	"last_attempt_reasons" text[] DEFAULT '{}' NOT NULL,
	"last_success_at" timestamp (3) with time zone,
	"permission_blocked" jsonb,
	"generation_at" timestamp (3) with time zone,
	"loaded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_atlas_kind_status" UNIQUE("platform","kind")
);
--> statement-breakpoint
ALTER TABLE "atlas_kind_status" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "atlas_entity_channel" ADD CONSTRAINT "fk_atlas_entity_channel_entity" FOREIGN KEY ("platform","kind","entity_id") REFERENCES "public"."atlas_entity"("platform","kind","entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_atlas_coverage_state" ON "atlas_coverage" USING btree ("platform","state");--> statement-breakpoint
CREATE INDEX "idx_atlas_entity_channel_entity" ON "atlas_entity_channel" USING btree ("platform","kind","entity_id");--> statement-breakpoint
CREATE INDEX "idx_atlas_entity_channel_channel" ON "atlas_entity_channel" USING btree ("platform","channel");--> statement-breakpoint
CREATE INDEX "idx_atlas_entity_channel_detail" ON "atlas_entity_channel" USING gin ("detail" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "idx_atlas_entity_platform_kind" ON "atlas_entity" USING btree ("platform","kind");--> statement-breakpoint
CREATE INDEX "idx_atlas_entity_provider" ON "atlas_entity" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "idx_atlas_gap_status" ON "atlas_gap" USING btree ("platform","status");--> statement-breakpoint
CREATE INDEX "idx_atlas_kind_status_success" ON "atlas_kind_status" USING btree ("platform","last_success_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "atlas_coverage_owner_all" ON "atlas_coverage" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "atlas_coverage_agent_read" ON "atlas_coverage" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "atlas_coverage_bot_read" ON "atlas_coverage" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "atlas_entity_channel_owner_all" ON "atlas_entity_channel" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "atlas_entity_channel_agent_read" ON "atlas_entity_channel" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "atlas_entity_channel_bot_read" ON "atlas_entity_channel" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "atlas_entity_owner_all" ON "atlas_entity" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "atlas_entity_agent_read" ON "atlas_entity" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "atlas_entity_bot_read" ON "atlas_entity" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "atlas_gap_owner_all" ON "atlas_gap" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "atlas_gap_agent_read" ON "atlas_gap" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "atlas_gap_bot_read" ON "atlas_gap" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "atlas_kind_status_owner_all" ON "atlas_kind_status" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "atlas_kind_status_agent_read" ON "atlas_kind_status" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "atlas_kind_status_bot_read" ON "atlas_kind_status" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);