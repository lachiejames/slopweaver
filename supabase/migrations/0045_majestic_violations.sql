ALTER TABLE "published_page" DROP CONSTRAINT "published_page_kind";--> statement-breakpoint
UPDATE "published_page" SET "kind" = 'history-only' WHERE "kind" = 'legacy-history';--> statement-breakpoint
ALTER TABLE "published_page" ADD CONSTRAINT "published_page_kind" CHECK (kind in ('local', 'history-only'));