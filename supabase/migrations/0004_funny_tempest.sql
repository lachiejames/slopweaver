CREATE TYPE "public"."memory_trace_outcome" AS ENUM('paid', 'empty');--> statement-breakpoint
ALTER TABLE "memories" DROP CONSTRAINT "memories_lesson_facets";--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "question" text;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "outcome" "memory_trace_outcome";--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_kind_facets" CHECK ((kind::text = 'lesson' and tier is not null and surface is not null
          and question is null and outcome is null)
        or (kind::text = 'preference' and tier is null and surface is null and repro is null
          and question is null and outcome is null)
        or (kind::text = 'trace' and tier is null and surface is null and repro is not null
          and question is not null and outcome is not null
          and (outcome::text = 'paid' or caveat is not null)));