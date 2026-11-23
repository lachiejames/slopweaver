/**
 * What the last Codex fleet read concluded about every registered destination, as one row in the store.
 *
 * Everything in `$SLOPWEAVER_HOME` moves into the local
 * store and the home becomes deletable. This record was `codex-fleet-cap.json`; it is the second register to make
 * the trip after `./planRegister.ts`. `src/codex/fleetCapStoreRows.ts` is the only reader and writer, and
 * `src/codex/fleetCapPort.ts` the door every consumer goes through.
 *
 * ## Why the ordering is a column, and the write one statement
 *
 * Several fleet reads run at once, and a slow one can finish after a quicker, later one. The file kept the newest by
 * reading, comparing and writing under an operation lock, and dropped a read that found the lock held. Here the
 * comparison is the upsert's own `WHERE read_at <= excluded.read_at`, so Postgres orders every concurrent writer and
 * none is dropped for arriving at the same moment: an older read simply changes nothing. `read_at` is the record's
 * `readAtIso`, held as a column only so the statement can compare it.
 *
 * ## Why a singleton
 *
 * One install has one fleet. The primary key is the literal {@link CODEX_FLEET_CAP_ID} and a CHECK refuses anything
 * else, as `plan_register` pins its own row. `revision` counts the writes that landed, so a reader can see a row moved.
 *
 * ## Why an attempt is a second pair of columns
 *
 * A filing that fails warns and returns, so without a trace the row would keep an EARLIER read's answer and the
 * monitor would draw it as the fleet's state. `unfiled` is the marker a filing writes first (`src/codex/fleetCapUnfiled.ts`)
 * and `attempted_at` its instant, ordered by its own `WHERE attempted_at <= excluded`, so a delayed attempt never
 * overwrites a later one. Both are null until a filing marks the row, and a CHECK keeps them null together.
 */
import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { CodexFleetCapRecord } from "../../codex/fleetCapRecord.js";
import type { CodexFleetCapUnfiled } from "../../codex/fleetCapUnfiled.js";

import { botSeesEverything, storeTablePolicies } from "./rls.js";

/** The only primary-key value `codex_fleet_cap` accepts, spelled once so a reader and the CHECK agree. */
export const CODEX_FLEET_CAP_ID = "fleet";

/**
 * The record, whole, beside the instant it was judged at and the count of writes that landed.
 *
 * `document` is typed through `$type` for the writer's convenience only: `jsonb` is not runtime validation, so every
 * read decodes it with `decodeCodexFleetCapRecord` before a monitor reads a row of it.
 */
export const codexFleetCapTable = pgTable(
  "codex_fleet_cap",
  {
    id: text("id").primaryKey(),
    document: jsonb("document").$type<CodexFleetCapRecord>().notNull(),
    readAt: timestamp("read_at", { mode: "date", withTimezone: true }).notNull(),
    revision: integer("revision").default(1).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    unfiled: jsonb("unfiled").$type<CodexFleetCapUnfiled>(),
    attemptedAt: timestamp("attempted_at", { mode: "date", withTimezone: true }),
  },
  () => [
    check("codex_fleet_cap_is_singleton", sql.raw(`id = '${CODEX_FLEET_CAP_ID}'`)),
    check("codex_fleet_cap_revision_positive", sql`revision > 0`),
    check("codex_fleet_cap_attempt_paired", sql`(unfiled is null) = (attempted_at is null)`),
    ...storeTablePolicies({ botRead: botSeesEverything(), table: "codex_fleet_cap" }),
  ],
);

/** The fleet-cap row as the database returns it. */
export type CodexFleetCapRow = typeof codexFleetCapTable.$inferSelect;

/** The fleet-cap row as an insert takes it. */
export type NewCodexFleetCapRow = typeof codexFleetCapTable.$inferInsert;
