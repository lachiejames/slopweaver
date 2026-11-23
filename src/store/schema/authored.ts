/**
 * The fleet's authored working state — every file under a directory `../fleet/authoredDirectories.ts`
 * classifies `authored` — in the store.
 *
 * About thirty small directories of it (briefs, artifacts, judgement, profile,
 * registers, morning and the rest) sit in no backup, no remote and no provider. The store is dumped to the backup
 * bucket daily, so a row here is a file that survives the machine. The standing direction is that
 * everything is taken out of the user-level Slopweaver directory and put into the store.
 *
 * ## The same two-table shape as `./ownerTurn.ts`, for the same reason
 *
 * A body is stored once, keyed by the sha-256 of its exact bytes ({@link authoredBodyTable}); every path it
 * was found at is a row of its own ({@link authoredFileTable}). A file EDITED since the last import is a new
 * body at the same path, and both stay — nothing here is ever overwritten, so an import can only add.
 *
 * ## `bytea`, not `text`
 *
 * Unlike an owner turn, this class holds images — `artifacts/`, `shots/`, `resume/` carry PNGs — and git
 * bundles, so the body is the raw bytes. Supabase Storage is the other place for media,
 * and nothing on this install writes Storage for this class (`../backup/plan.ts`'s header, measured: zero
 * buckets, zero objects), so a bytea column keeps the class on the one mechanism the daily dump already carries.
 *
 * The bot is denied both tables: `sessions/` holds grants and `talk/` holds the owner's spoken words.
 */
import { sql } from "drizzle-orm";
import { check, customType, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { storeTablePolicies } from "./rls.js";

/** Postgres `bytea`, which Drizzle has no builder for. postgres.js returns it as a `Buffer`. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/** One distinct file body, keyed by the sha-256 of its exact bytes. */
export const authoredBodyTable = pgTable(
  "authored_body",
  {
    /** Lower-case hex sha-256 of the file's exact bytes. */
    bodySha256: text("body_sha256").primaryKey(),
    /** The file's bytes, verbatim. */
    body: bytea("body").notNull(),
    /** The body's length, so a restore can check it wrote back what was read. */
    byteLength: integer("byte_length").notNull(),
    /** When the store first held this body — not when it was written. */
    firstImportedAt: timestamp("first_imported_at", { mode: "date", precision: 3, withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  () => [
    check("authored_body_sha_shape", sql`body_sha256 ~ '^[0-9a-f]{64}$'`),
    check("authored_body_byte_length_matches", sql`byte_length = octet_length(body)`),
    ...storeTablePolicies({ botRead: sql`false`, table: "authored_body" }),
  ],
);

/**
 * One place a body was found: a path under the home, and the top-level directory it sat in.
 *
 * `file_modified_at` is the file's mtime, so `store authored show` and `restore` take the NEWEST write at a
 * path as that path's current contents.
 */
export const authoredFileTable = pgTable(
  "authored_file",
  {
    /** The file's path relative to the state home, `/`-separated. */
    relativePath: text("relative_path").notNull(),
    bodySha256: text("body_sha256")
      .notNull()
      .references(() => authoredBodyTable.bodySha256, { onDelete: "cascade" }),
    /** The top-level home directory the file sat under — its first path segment. */
    directory: text("directory").notNull(),
    fileModifiedAt: timestamp("file_modified_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // A re-import of an unchanged file conflicts on this key and writes nothing; an edited file is a new key.
    primaryKey({ columns: [table.relativePath, table.bodySha256], name: "authored_file_pk" }),
    check("authored_file_directory_is_first_segment", sql`split_part(relative_path, '/', 1) = directory`),
    // `show` and `restore` — the newest write at one path, and every path under one directory.
    index("idx_authored_file_path_time").on(table.relativePath, table.fileModifiedAt.desc()),
    index("idx_authored_file_directory").on(table.directory),
    index("idx_authored_file_sha").on(table.bodySha256),
    ...storeTablePolicies({ botRead: sql`false`, table: "authored_file" }),
  ],
);

/**
 * A stored path the last import did not find on disk — deleted, swept or moved since it was stored.
 *
 * {@link authoredFileTable} only ever adds, so without this a restore writes back the newest stored version of
 * every path the home ever held. MEASURED on the first rehearsal into an empty home: 22 recipe
 * definitions came back that live had deleted, one of them a HubSpot resync. The import replaces this set on
 * every run it walked the whole home, so a path that reappears leaves it; `store authored-restore` writes none
 * of them.
 */
export const authoredAbsentTable = pgTable(
  "authored_absent",
  {
    /** The stored path, relative to the state home, `/`-separated. */
    relativePath: text("relative_path").primaryKey(),
    /** The first import that did not find it; kept while it stays absent. */
    noticedAt: timestamp("noticed_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  () => [...storeTablePolicies({ botRead: sql`false`, table: "authored_absent" })],
);

/** A body as the database returns it. */
export type AuthoredBodyRecord = typeof authoredBodyTable.$inferSelect;

/** A body as an insert takes it. */
export type NewAuthoredBodyRecord = typeof authoredBodyTable.$inferInsert;

/** A location as the database returns it. */
export type AuthoredFileRecord = typeof authoredFileTable.$inferSelect;

/** A location as an insert takes it. */
export type NewAuthoredFileRecord = typeof authoredFileTable.$inferInsert;
