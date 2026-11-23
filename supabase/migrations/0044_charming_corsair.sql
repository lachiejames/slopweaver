CREATE TABLE "published_page_alias" (
	"address" text PRIMARY KEY NOT NULL,
	"page_key" text NOT NULL,
	"page_kind" text DEFAULT 'local' NOT NULL,
	"source" text NOT NULL,
	"discovered_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "published_page_alias_kind_local" CHECK (page_kind = 'local'),
	CONSTRAINT "published_page_alias_address_shape" CHECK (length(address) > 0),
	CONSTRAINT "published_page_alias_source" CHECK (source in ('home-register', 'store-row', 'symlink-resolved'))
);
--> statement-breakpoint
ALTER TABLE "published_page_alias" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "published_page_blob" (
	"body_sha256" text PRIMARY KEY NOT NULL,
	"byte_length" integer NOT NULL,
	"media_type" text NOT NULL,
	"first_stored_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "published_page_blob_sha_shape" CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "published_page_blob_byte_length_non_negative" CHECK (byte_length >= 0)
);
--> statement-breakpoint
ALTER TABLE "published_page_blob" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "published_page_file" (
	"page_key" text NOT NULL,
	"page_kind" text DEFAULT 'local' NOT NULL,
	"relative_path" text NOT NULL,
	"body_sha256" text NOT NULL,
	CONSTRAINT "published_page_file_pk" PRIMARY KEY("page_key","relative_path"),
	CONSTRAINT "published_page_file_kind_local" CHECK (page_kind = 'local'),
	CONSTRAINT "published_page_file_path_shape" CHECK (relative_path ~ '^[^/]+(/[^/]+)*$' and relative_path !~ '\\' and relative_path !~ '(^|/)\.{1,2}(/|$)')
);
--> statement-breakpoint
ALTER TABLE "published_page_file" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "published_page" (
	"page_key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"canonical_address" text,
	"current_body_sha256" text,
	"latest_frozen_body_sha256" text,
	"latest_frozen_at" timestamp (3) with time zone,
	"published_at" timestamp (3) with time zone,
	CONSTRAINT "published_page_key_kind" UNIQUE("page_key","kind"),
	CONSTRAINT "published_page_key_shape" CHECK (page_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
	CONSTRAINT "published_page_kind" CHECK (kind in ('local', 'legacy-history')),
	CONSTRAINT "published_page_local_shape" CHECK ((kind = 'local') = (canonical_address is not null)
        and (kind = 'local') = (current_body_sha256 is not null)
        and (kind = 'local') = (published_at is not null)),
	CONSTRAINT "published_page_frozen_pair" CHECK ((latest_frozen_body_sha256 is null) = (latest_frozen_at is null))
);
--> statement-breakpoint
ALTER TABLE "published_page" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "published_page_version" (
	"page_key" text NOT NULL,
	"body_sha256" text NOT NULL,
	"first_frozen_at" timestamp (3) with time zone NOT NULL,
	"origin" text NOT NULL,
	CONSTRAINT "published_page_version_pk" PRIMARY KEY("page_key","body_sha256"),
	CONSTRAINT "published_page_version_origin" CHECK (origin in ('published', 'imported'))
);
--> statement-breakpoint
ALTER TABLE "published_page_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "published_page_alias" ADD CONSTRAINT "published_page_alias_local_page_fk" FOREIGN KEY ("page_key","page_kind") REFERENCES "public"."published_page"("page_key","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_page_file" ADD CONSTRAINT "published_page_file_body_sha256_published_page_blob_body_sha256_fk" FOREIGN KEY ("body_sha256") REFERENCES "public"."published_page_blob"("body_sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_page_file" ADD CONSTRAINT "published_page_file_local_page_fk" FOREIGN KEY ("page_key","page_kind") REFERENCES "public"."published_page"("page_key","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_page" ADD CONSTRAINT "published_page_current_body_sha256_published_page_blob_body_sha256_fk" FOREIGN KEY ("current_body_sha256") REFERENCES "public"."published_page_blob"("body_sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_page" ADD CONSTRAINT "published_page_latest_frozen_body_sha256_published_page_blob_body_sha256_fk" FOREIGN KEY ("latest_frozen_body_sha256") REFERENCES "public"."published_page_blob"("body_sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_page_version" ADD CONSTRAINT "published_page_version_page_key_published_page_page_key_fk" FOREIGN KEY ("page_key") REFERENCES "public"."published_page"("page_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_page_version" ADD CONSTRAINT "published_page_version_body_sha256_published_page_blob_body_sha256_fk" FOREIGN KEY ("body_sha256") REFERENCES "public"."published_page_blob"("body_sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_published_page_alias_key" ON "published_page_alias" USING btree ("page_key");--> statement-breakpoint
CREATE INDEX "idx_published_page_file_sha" ON "published_page_file" USING btree ("body_sha256");--> statement-breakpoint
CREATE INDEX "idx_published_page_version_sha" ON "published_page_version" USING btree ("body_sha256");--> statement-breakpoint
CREATE POLICY "published_page_alias_owner_all" ON "published_page_alias" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "published_page_alias_agent_read" ON "published_page_alias" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "published_page_alias_bot_read" ON "published_page_alias" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "published_page_blob_owner_all" ON "published_page_blob" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "published_page_blob_agent_read" ON "published_page_blob" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "published_page_blob_bot_read" ON "published_page_blob" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "published_page_file_owner_all" ON "published_page_file" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "published_page_file_agent_read" ON "published_page_file" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "published_page_file_bot_read" ON "published_page_file" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "published_page_owner_all" ON "published_page" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "published_page_agent_read" ON "published_page" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "published_page_bot_read" ON "published_page" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);--> statement-breakpoint
CREATE POLICY "published_page_version_owner_all" ON "published_page_version" AS PERMISSIVE FOR ALL TO "slopweaver_owner" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "published_page_version_agent_read" ON "published_page_version" AS PERMISSIVE FOR SELECT TO "slopweaver_agent" USING (true);--> statement-breakpoint
CREATE POLICY "published_page_version_bot_read" ON "published_page_version" AS PERMISSIVE FOR SELECT TO "slopweaver_bot" USING (false);