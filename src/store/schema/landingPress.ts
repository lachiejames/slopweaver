/**
 * Every merge-queue press `github landing --press` and `github bump-drive` made, WITH its subject — the press
 * register, as an append-only table.
 *
 * `src/review/pressJournal.ts` carries why the register exists at all (the door ledger records an enqueue and
 * never its target) and why `head_oid` is its load-bearing column. This table is where it LIVES: the old
 * `landing-presses.jsonl` is imported once (`./homeFileImport.ts`) and never read again.
 *
 * ## Append-only, keyed by what the press was
 *
 * `press_key` is the sha-256 of the canonical tuple `[repoSlug, number, headOid, atIso]`
 * (`src/review/pressJournal.ts`'s `pressKey`), so the one-time import and a writer racing it cannot file one
 * press twice, and every insert is `ON CONFLICT DO NOTHING` — nothing here overwrites anything.
 *
 * ## Why the instant is TEXT, and why there is an ordinal
 *
 * `at_iso` is the exact string the writer stamped: it is part of the key, it is compared as a string by the
 * fold that picks each pull request's latest press, and a `timestamptz` round trip would re-spell it.
 * `recorded_at` is the store's own audit time beside it. The fold breaks an equal-instant tie by insertion
 * order, which a file gave for free and SQL does not, so `ordinal` is an identity column and every read
 * orders by it.
 *
 * The bot is denied the table: which pull request was pressed at which head is repository activity no Slack
 * reader needs.
 */
import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { storeTablePolicies } from "./rls.js";

/** One recorded press. */
export const landingPressTable = pgTable(
  "landing_press",
  {
    /** Lower-case hex sha-256 of the canonical press tuple: the idempotency key. */
    pressKey: text("press_key").primaryKey(),
    /** Insertion order, the tie-break an equal `at_iso` needs. */
    ordinal: bigint("ordinal", { mode: "number" }).generatedAlwaysAsIdentity().notNull().unique(),
    repoSlug: text("repo_slug").notNull(),
    number: integer("number").notNull(),
    /** The head the press was pinned to. */
    headOid: text("head_oid").notNull(),
    /** The queue entry GitHub reported on the read-back, or the empty string when it reported none. */
    entryState: text("entry_state").notNull(),
    /** When the press was made, exactly as the writer spelled it. */
    atIso: text("at_iso").notNull(),
    recordedAt: timestamp("recorded_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("landing_press_key_shape", sql`press_key ~ '^[0-9a-f]{64}$'`),
    check("landing_press_number_positive", sql`number > 0`),
    check("landing_press_head_present", sql`head_oid <> ''`),
    check("landing_press_repo_present", sql`repo_slug <> ''`),
    // "every press of this pull request, in order", which is the fold's whole question.
    index("idx_landing_press_subject").on(table.repoSlug, table.number, table.ordinal),
    ...storeTablePolicies({ botRead: sql`false`, table: "landing_press" }),
  ],
);

/** A press row as the database returns it. */
export type LandingPressRow = typeof landingPressTable.$inferSelect;
