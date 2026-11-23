CREATE TYPE "public"."data_class" AS ENUM('public', 'internal', 'personal', 'restricted', 'unknown');--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "data_class" "data_class";--> statement-breakpoint
ALTER TABLE "owner_capture" ADD COLUMN "data_class" "data_class";--> statement-breakpoint
ALTER TABLE "owner_turn" ADD COLUMN "data_class" "data_class";