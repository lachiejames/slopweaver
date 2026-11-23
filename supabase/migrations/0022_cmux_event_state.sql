CREATE TABLE "cmux_event_state" (
	"consumer" text PRIMARY KEY NOT NULL,
	"cursor_seq" bigint NOT NULL,
	"activities" jsonb,
	"recorded_at" timestamp with time zone NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cmux_event_state_known_consumer" CHECK (consumer in ('session-watch', 'cmux-events')),
	CONSTRAINT "cmux_event_state_fold_where_it_belongs" CHECK ((activities is not null) = (consumer = 'session-watch')),
	CONSTRAINT "cmux_event_state_cursor_safe" CHECK (cursor_seq >= 0 and cursor_seq <= 9007199254740991),
	CONSTRAINT "cmux_event_state_revision_positive" CHECK (revision > 0)
);
--> statement-breakpoint
ALTER TABLE "cmux_event_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "cmux_event_state_owner_all" ON "cmux_event_state" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "cmux_event_state_agent_read" ON "cmux_event_state" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "cmux_event_state_bot_read" ON "cmux_event_state" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (true);