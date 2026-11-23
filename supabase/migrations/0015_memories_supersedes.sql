ALTER TABLE "memories" ADD COLUMN "supersedes" text;--> statement-breakpoint
CREATE INDEX "idx_memories_supersedes" ON "memories" USING btree ("supersedes");