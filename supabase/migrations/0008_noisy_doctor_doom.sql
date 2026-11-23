ALTER TABLE "content" ADD COLUMN "parent_source_id" text;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_parent_id_content_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_content_parent" ON "content" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_content_parent_unresolved" ON "content" USING btree ("source","parent_source_id") WHERE parent_id is null and parent_source_id is not null;