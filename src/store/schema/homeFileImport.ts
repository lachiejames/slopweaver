/**
 * Which home files a register has already been imported from — one row per register, written once.
 *
 * Everything in `$SLOPWEAVER_HOME` moves into the local store and the home
 * becomes deletable. A register that moves keeps its old file only as the source of ONE import, and this
 * table is how a multi-row register knows that import already happened. A singleton such as
 * `./planRegister.ts` can use its own row's existence as the marker; a table of presses or retirements cannot,
 * because "the table is empty" is also true of a register that was imported from an empty file — and a write
 * made before the first read would otherwise leave the file's history stranded behind a non-empty table.
 *
 * ## Absent is a result, not a gap
 *
 * A home with no file still gets a row, `source_state = 'absent'` with zero records. Without it a file that
 * appeared later — written by a seat still running code from before the move — would be imported into a
 * register that had already been the authority for a while. With it, every later file is ignored, which is
 * the documented upgrade boundary rather than a silent merge.
 *
 * ## A witnessed register keeps the file's digest
 *
 * A register whose file is a journal of the owner's words (`standing-asks`, `steer-measurements`) records the imported file's sha256 and size on
 * its present marker, required by CHECK. Every later operation reads the old path again: absent, or exactly the
 * witnessed bytes, and the store answers; anything else refuses, so an append made after the import by a build
 * from before it is never silently dropped.
 *
 * The marker and the rows it imported commit in ONE transaction (`../registerImport.ts`), so no reader can
 * see a marker whose rows are missing. A file that cannot be read or decoded writes neither.
 */
import { sql } from "drizzle-orm";
import { bigint, check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { storeTablePolicies } from "./rls.js";

/** The registers whose home file is imported once, spelled once so a writer and a reader agree. */
export const HOME_FILE_IMPORT_REGISTERS = [
  "landing-presses",
  "landing-reads",
  "codex-supersessions",
  "owner-judgement",
  "standing-asks",
  "steer-measurements",
  "knowledge-domains",
] as const;

/** One register's name on the marker row. */
export type HomeFileImportRegister = (typeof HOME_FILE_IMPORT_REGISTERS)[number];

/** One marker per register: whether a file was there, and how many records it held. */
export const homeFileImportTable = pgTable(
  "home_file_import",
  {
    register: text("register").primaryKey(),
    /** `present` when a file was read, `absent` when the home held none. */
    sourceState: text("source_state").$type<"absent" | "present">().notNull(),
    /** How many decoded records the file offered; a conflict on a domain key can insert fewer. */
    records: integer("records").notNull(),
    /** The imported file's `sha256:` digest, on a witnessed register's present marker. */
    sourceSha256: text("source_sha256"),
    /** The imported file's size in bytes, beside its digest. */
    sourceBytes: bigint("source_bytes", { mode: "number" }),
    importedAt: timestamp("imported_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("home_file_import_source_state", sql`source_state in ('absent', 'present')`),
    check("home_file_import_records_nonnegative", sql`records >= 0`),
    check("home_file_import_absent_is_empty", sql`source_state = 'present' or records = 0`),
    check("home_file_import_witness_pair", sql`(source_sha256 is null) = (source_bytes is null)`),
    check(
      "home_file_import_witness_shape",
      sql`source_sha256 is null or (source_sha256 ~ '^sha256:[0-9a-f]{64}$' and source_bytes >= 0)`,
    ),
    check("home_file_import_witness_present", sql`source_state = 'present' or source_sha256 is null`),
    check(
      "home_file_import_witness_required",
      sql`register not in ('standing-asks', 'steer-measurements') or source_state = 'absent' or source_sha256 is not null`,
    ),
    ...storeTablePolicies({ botRead: sql`false`, table: "home_file_import" }),
  ],
);

/** A marker row as the database returns it. */
export type HomeFileImportRow = typeof homeFileImportTable.$inferSelect;
