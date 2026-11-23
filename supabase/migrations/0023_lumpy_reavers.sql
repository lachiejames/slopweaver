ALTER TABLE "codex_fleet_cap" ADD COLUMN "unfiled" jsonb;--> statement-breakpoint
ALTER TABLE "codex_fleet_cap" ADD COLUMN "attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "codex_fleet_cap" ADD CONSTRAINT "codex_fleet_cap_attempt_paired" CHECK ((unfiled is null) = (attempted_at is null));