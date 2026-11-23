CREATE TABLE "owner_capture" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"said_at" timestamp (3) with time zone NOT NULL,
	"body" text NOT NULL,
	"body_sha256" text NOT NULL,
	"byte_length" integer NOT NULL,
	"target_application" text,
	"duration_ms" integer,
	"thread_id" text,
	"codex_surface" text,
	"codex_thread_source" text,
	"cwd" text,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_capture_source" CHECK (source in ('superwhisper', 'codex')),
	CONSTRAINT "owner_capture_sha_shape" CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "owner_capture_body_present" CHECK (byte_length > 0 and byte_length = octet_length(body)),
	CONSTRAINT "owner_capture_codex_thread" CHECK (source <> 'codex' or (thread_id is not null and codex_surface is not null))
);
--> statement-breakpoint
ALTER TABLE "owner_capture" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_owner_capture_source_id" ON "owner_capture" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "idx_owner_capture_said_at" ON "owner_capture" USING btree ("said_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "owner_capture_owner_all" ON "owner_capture" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "owner_capture_agent_read" ON "owner_capture" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "owner_capture_bot_read" ON "owner_capture" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);