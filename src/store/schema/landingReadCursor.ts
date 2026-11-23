/**
 * When the fleet landing read last completed, per canonical selection — the cadence cursor `github landing
 * --if-due` judges every sweep tick against.
 *
 * `src/review/readJournal.ts` carries why the cadence is a mechanism rather than a sentence, and the pure
 * `readDue` that decides a tick. This table is where the cursor LIVES: the old `landing-reads.json` is imported
 * once (`./homeFileImport.ts`) and never read again.
 *
 * ## One row per selection, changed by compare-and-set
 *
 * Only the LATEST completed read decides anything, so a selection has one row. A write pins the `revision` it
 * read and updates `WHERE revision = N`; a miss is a conflict reported to the caller and never retried, because
 * a last-writer-wins upsert would let an older completion that lost a race overwrite a newer one.
 *
 * `at_iso` is TEXT for the reason `./landingPress.ts` gives: the exact instant the writer stamped, never
 * re-spelled by a `timestamptz` round trip.
 *
 * The bot is denied the table: nothing Slack-facing reads the cadence.
 */
import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { storeTablePolicies } from "./rls.js";

/** One selection's latest completed read. */
export const landingReadCursorTable = pgTable(
  "landing_read_cursor",
  {
    /** The canonical selection key, as `src/review/readJournal.ts`'s `selectionKey` spells one. */
    selection: text("selection").primaryKey(),
    /** When the read COMPLETED, exactly as the writer spelled it. */
    atIso: text("at_iso").notNull(),
    /** How many open pull requests it judged. */
    rows: integer("rows").notNull(),
    /** How many of them the supervisor may dispatch a session for. */
    dispatchable: integer("dispatchable").notNull(),
    revision: integer("revision").default(1).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("landing_read_cursor_rows_nonnegative", sql`rows >= 0`),
    check("landing_read_cursor_dispatchable_bounded", sql`dispatchable >= 0 and dispatchable <= rows`),
    check("landing_read_cursor_revision_positive", sql`revision > 0`),
    check("landing_read_cursor_selection_present", sql`selection <> ''`),
    ...storeTablePolicies({ botRead: sql`false`, table: "landing_read_cursor" }),
  ],
);

/** A cursor row as the database returns it. */
export type LandingReadCursorRow = typeof landingReadCursorTable.$inferSelect;
