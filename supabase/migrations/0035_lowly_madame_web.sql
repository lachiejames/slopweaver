CREATE TABLE "door_register" (
	"id" text PRIMARY KEY NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "door_register_is_singleton" CHECK (id = 'door')
);
--> statement-breakpoint
ALTER TABLE "door_register" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "door_event" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "door_event" ADD COLUMN "record" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_door_event_seq" ON "door_event" USING btree ("seq");--> statement-breakpoint
ALTER TABLE "door_event" ADD CONSTRAINT "door_event_record_is_object" CHECK (record is null or jsonb_typeof(record) = 'object');--> statement-breakpoint
ALTER TABLE "door_event" ADD CONSTRAINT "door_event_seq_is_safe" CHECK (seq between 1 and 9007199254740991);--> statement-breakpoint
CREATE POLICY "door_register_owner_all" ON "door_register" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "door_register_agent_read" ON "door_register" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "door_register_bot_read" ON "door_register" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);