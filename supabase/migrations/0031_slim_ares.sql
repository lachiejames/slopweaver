CREATE TABLE "autonomy_register" (
	"id" text PRIMARY KEY NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autonomy_register_is_singleton" CHECK (id = 'autonomy')
);
--> statement-breakpoint
ALTER TABLE "autonomy_register" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "autonomy_event" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "autonomy_event" ADD COLUMN "record" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_autonomy_event_seq" ON "autonomy_event" USING btree ("seq");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_autonomy_event_one_action" ON "autonomy_event" USING btree ("action_id") WHERE entry_kind = 'action' and record is not null;--> statement-breakpoint
ALTER TABLE "autonomy_event" ADD CONSTRAINT "autonomy_event_record_is_object" CHECK (record is null or jsonb_typeof(record) = 'object');--> statement-breakpoint
CREATE POLICY "autonomy_register_owner_all" ON "autonomy_register" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "autonomy_register_agent_read" ON "autonomy_register" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "autonomy_register_bot_read" ON "autonomy_register" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);