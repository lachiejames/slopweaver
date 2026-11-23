CREATE TYPE "public"."steer_measurement_origin" AS ENUM('legacy-file', 'profile', 'store-import');--> statement-breakpoint
CREATE TABLE "steer_measurement" (
	"event_id" text PRIMARY KEY NOT NULL,
	"journal_seq" bigint NOT NULL,
	"origin" "steer_measurement_origin" NOT NULL,
	"exact_line" text NOT NULL,
	"source_ordinal" bigint,
	"stored_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_steer_measurement_seq" UNIQUE("journal_seq"),
	CONSTRAINT "steer_measurement_event_id" CHECK (event_id ~ '^steer-(legacy-[0-9a-f]{64}|event-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'),
	CONSTRAINT "steer_measurement_seq" CHECK (journal_seq > 0 and journal_seq <= 9007199254740991),
	CONSTRAINT "steer_measurement_line" CHECK (exact_line ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' and strpos(exact_line, chr(10)) = 0),
	CONSTRAINT "steer_measurement_source_ordinal" CHECK (source_ordinal is null or (source_ordinal > 0 and source_ordinal <= 9007199254740991)),
	CONSTRAINT "steer_measurement_legacy" CHECK ((origin <> 'legacy-file' or (event_id like 'steer-legacy-%' and source_ordinal = journal_seq))
        and (origin <> 'profile' or (event_id like 'steer-event-%' and source_ordinal is null))
        and ((event_id like 'steer-legacy-%') = (source_ordinal is not null)))
);
--> statement-breakpoint
ALTER TABLE "steer_measurement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "home_file_import" DROP CONSTRAINT "home_file_import_witness_required";--> statement-breakpoint
ALTER TABLE "home_file_import" ADD CONSTRAINT "home_file_import_witness_required" CHECK (register not in ('standing-asks', 'steer-measurements') or source_state = 'absent' or source_sha256 is not null);--> statement-breakpoint
CREATE POLICY "steer_measurement_owner_all" ON "steer_measurement" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "steer_measurement_agent_read" ON "steer_measurement" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "steer_measurement_bot_read" ON "steer_measurement" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);