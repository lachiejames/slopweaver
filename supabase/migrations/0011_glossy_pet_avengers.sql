CREATE TABLE "authored_body" (
	"body_sha256" text PRIMARY KEY NOT NULL,
	"body" "bytea" NOT NULL,
	"byte_length" integer NOT NULL,
	"first_imported_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authored_body_sha_shape" CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "authored_body_byte_length_matches" CHECK (byte_length = octet_length(body))
);
--> statement-breakpoint
ALTER TABLE "authored_body" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "authored_file" (
	"relative_path" text NOT NULL,
	"body_sha256" text NOT NULL,
	"directory" text NOT NULL,
	"file_modified_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authored_file_pk" PRIMARY KEY("relative_path","body_sha256"),
	CONSTRAINT "authored_file_directory_is_first_segment" CHECK (split_part(relative_path, '/', 1) = directory)
);
--> statement-breakpoint
ALTER TABLE "authored_file" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "authored_file" ADD CONSTRAINT "authored_file_body_sha256_authored_body_body_sha256_fk" FOREIGN KEY ("body_sha256") REFERENCES "public"."authored_body"("body_sha256") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_authored_file_path_time" ON "authored_file" USING btree ("relative_path","file_modified_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_authored_file_directory" ON "authored_file" USING btree ("directory");--> statement-breakpoint
CREATE INDEX "idx_authored_file_sha" ON "authored_file" USING btree ("body_sha256");--> statement-breakpoint
CREATE POLICY "authored_body_owner_all" ON "authored_body" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "authored_body_agent_read" ON "authored_body" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "authored_body_bot_read" ON "authored_body" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "authored_file_owner_all" ON "authored_file" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "authored_file_agent_read" ON "authored_file" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "authored_file_bot_read" ON "authored_file" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);