ALTER TABLE "grant_row" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_grant_row_seq" ON "grant_row" USING btree ("seq");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_grant_row_one_grant" ON "grant_row" USING btree ("grant_id") WHERE entry_kind = 'grant';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_grant_row_one_performance" ON "grant_row" USING btree ("grant_id") WHERE entry_kind = 'performance';