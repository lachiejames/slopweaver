/**
 * The fleet's state in the store: the capacity setting, and the two append-only journals — the recovery journal
 * `fleet resume` writes and `fleet health` reads, and the cmux revive journal `cmux revive` and a seat's dialog
 * decline write. Home-into-the-store part 6: these rows are the authority, and
 * `$SLOPWEAVER_HOME/fleet/{config.json,resume.jsonl,cmux-revive.jsonl}` are read once, as an import, and never
 * again. `src/fleet/storePort.ts` is the only reader and writer.
 *
 * ## Why the journals share one event table and one head table
 *
 * Both journals are the same shape — an ordered run of decoded events, read as a bounded newest tail — and differ
 * only in which decoder reads them. So one statement set serves both, keyed by `journal`, rather than two tables
 * whose SQL would have to be kept identical by hand.
 *
 * `fleet_journal` is each journal's HEAD: its committed row says the legacy file was considered (imported, found
 * empty, or found absent), and `latest_sequence` is the counter every append bumps inside the same transaction as
 * its event insert, so a sequence is never visible without its event and two appends can never take one number.
 * That counter is also what `cmux revive` compares across a probe to see whether anything was journalled in
 * between — the job the file's byte size used to do, done exactly rather than by size.
 *
 * ## An unreadable legacy line is a placeholder, never its text
 *
 * A line of the old file that would not decode is imported as a row with a null `event` and its line number, so a
 * reader still sees an unreadable entry exactly where it fell (`src/fleet/journal.ts`'s `newestAttemptReadWhole`
 * depends on that position). Its raw text is NOT kept: a hand-written line cannot be shown to be free of a secret.
 * A live append is always a decoded event, so the CHECK admits a null event only on an imported row.
 *
 * ## Why the event kinds are not CHECKed
 *
 * `jsonb` is not validation, and every read decodes each row with the journal's own schema. A CHECK naming the kinds
 * would make every new event kind a migration, and a row a newer checkout wrote reads, to an older one, as one
 * unreadable entry — exactly what the file did.
 */
import { sql } from "drizzle-orm";
import { bigint, check, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { botSeesEverything, storeTablePolicies } from "./rls.js";

/** The only primary-key value `fleet_config` accepts, spelled once so a reader and the CHECK agree. */
export const FLEET_CONFIG_ID = "fleet";

/** The two journals, spelled once for the CHECKs and the port. */
export const FLEET_JOURNALS = ["resume", "cmux-revive"] as const;

/** One of the fleet's journals. */
export type FleetJournalName = (typeof FLEET_JOURNALS)[number];

/** What the one-time import found where a journal's file was. */
export const FLEET_JOURNAL_IMPORT_SOURCES = ["absent", "empty", "present"] as const;

/** One of {@link FLEET_JOURNAL_IMPORT_SOURCES}. */
export type FleetJournalImportSource = (typeof FLEET_JOURNAL_IMPORT_SOURCES)[number];

/** The `IN (...)` list of a closed set, for a CHECK. */
function oneOf({ values }: { values: readonly string[] }): string {
  return values.map((value) => `'${value}'`).join(", ");
}

/**
 * The capacity setting, one row, beside the revision a compare-and-set pins to — the shape `./planRegister.ts`
 * established, with the setting's own bounds CHECKed (`MAX_FLEET_CAPACITY` in `src/fleet/config.ts` is 100).
 */
export const fleetConfigTable = pgTable(
  "fleet_config",
  {
    id: text("id").primaryKey(),
    schemaVersion: integer("schema_version").default(1).notNull(),
    capacity: integer("capacity").notNull(),
    revision: integer("revision").default(1).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("fleet_config_is_singleton", sql.raw(`id = '${FLEET_CONFIG_ID}'`)),
    check("fleet_config_schema_version", sql`schema_version = 1`),
    check("fleet_config_capacity_range", sql`capacity BETWEEN 1 AND 100`),
    check("fleet_config_revision_positive", sql`revision > 0`),
    ...storeTablePolicies({ botRead: botSeesEverything(), table: "fleet_config" }),
  ],
);

/** Each journal's head: the import marker and the append counter. */
export const fleetJournalTable = pgTable(
  "fleet_journal",
  {
    journal: text("journal").primaryKey(),
    latestSequence: bigint("latest_sequence", { mode: "number" }).default(0).notNull(),
    importSource: text("import_source").notNull(),
    importUnreadable: integer("import_unreadable").default(0).notNull(),
    importedAt: timestamp("imported_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("fleet_journal_name", sql.raw(`journal IN (${oneOf({ values: FLEET_JOURNALS })})`)),
    check(
      "fleet_journal_import_source",
      sql.raw(`import_source IN (${oneOf({ values: FLEET_JOURNAL_IMPORT_SOURCES })})`),
    ),
    check("fleet_journal_sequence_non_negative", sql`latest_sequence >= 0`),
    check("fleet_journal_unreadable_non_negative", sql`import_unreadable >= 0`),
    ...storeTablePolicies({ botRead: sql`false`, table: "fleet_journal" }),
  ],
);

/** One journalled event, in its journal's order. */
export const fleetJournalEventTable = pgTable(
  "fleet_journal_event",
  {
    journal: text("journal")
      .notNull()
      .references(() => fleetJournalTable.journal),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    /** `unknown` on purpose: every read decodes it. Null only on an imported line that would not decode. */
    event: jsonb("event").$type<unknown>(),
    /** The 1-based line of the journal file this row was imported from; null on a live append. */
    importLine: integer("import_line"),
    insertedAt: timestamp("inserted_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.journal, table.sequence], name: "fleet_journal_event_pk" }),
    check("fleet_journal_event_sequence_positive", sql`sequence > 0`),
    check("fleet_journal_event_import_line_positive", sql`import_line IS NULL OR import_line > 0`),
    check("fleet_journal_event_placeholder_is_imported", sql`event IS NOT NULL OR import_line IS NOT NULL`),
    check("fleet_journal_event_is_object", sql`event IS NULL OR jsonb_typeof(event) = 'object'`),
    ...storeTablePolicies({ botRead: sql`false`, table: "fleet_journal_event" }),
  ],
);

/** The config row as the database returns it. */
export type FleetConfigRow = typeof fleetConfigTable.$inferSelect;

/** A journal head as the database returns it. */
export type FleetJournalRow = typeof fleetJournalTable.$inferSelect;

/** A journal event as the database returns it. */
export type FleetJournalEventRow = typeof fleetJournalEventTable.$inferSelect;
