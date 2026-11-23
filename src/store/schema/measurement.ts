/**
 * The measurements — the bake-off laps, the Datadog shots, the investigation evidence and the pull-request
 * proof the fleet wrote under the state home — in the store.
 *
 * These trees sit in no backup, though each one cost real queries to take and canon
 * cites them as anchors (`~/.slopweaver/evidence/token-usage-audit-03sep.md`,
 * `$SLOPWEAVER_HOME/proof/no-fold-slack-schema/no-fold-proof-12sep-1121.png`). What is important goes into
 * the database and is queried from the database, so the user-level slopweaver directory can in
 * principle be removed without losing any functionality.
 *
 * ## The same two-table shape as `./ownerTurn.ts`, for the same reason
 *
 * A body is stored once, keyed by the sha-256 of its exact bytes ({@link measurementBlobTable}); every path it
 * was found at is a row of its own ({@link measurementLocationTable}). MEASURED: the four roots
 * hold 885 files but only 410 distinct contents, because a bake-off lap copies its predecessor's candidates
 * (repro: `cd ~/.slopweaver && find bakeoff datadog-shots evidence proof -type f ! -name .DS_Store -print0 |
 * xargs -0 shasum -a 256 | cut -c1-64 | sort -u | wc -l`). Append-only by construction: an edited file is a
 * new row at the same path, so the version an anchor cited is never replaced underneath it.
 *
 * ## A location row is an OBSERVATION, and "newest" is by import, never by mtime
 *
 * An import records a path only when its body differs from the one the store last recorded there, so a file
 * edited A → B → A gains a third row naming A again, and that row is the newest. Ordering by the file's own
 * mtime instead would hand back B for that file, and for any file an archiver or `cp -p` gave an older mtime.
 *
 * ## Where a body's bytes live: `placement`
 *
 * Text a Postgres `text` column can hold byte-for-byte, up to `INLINE_BODY_MAX_BYTES`
 * (`../fleet/measurement.ts`), is `inline` in `body`. Everything else — every image, and the two bake-off
 * replies whose bytes are not UTF-8 — is `storage`: its bytes are an object in the Supabase Storage bucket
 * `measurements` at the key `<body_sha256>`, which is the rule that media go into Storage. The key
 * is a RULE rather than a column, so there is no second truth that could disagree with the hash. Both
 * halves are backed up: the `storage` schema rides `store.dump`, the bytes ride `storage.tar`.
 *
 * `class` is text with a CHECK rather than an enum, for the reason `./ownerTurn.ts` gives for `family`.
 *
 * The bot is denied both tables outright: `evidence/` holds session transcripts that quote private channels
 * and name colleagues.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { storeTablePolicies } from "./rls.js";

/** The four roots of the class, each a directory directly under the state home. */
export const MEASUREMENT_CLASSES = ["bakeoff", "datadog-shots", "evidence", "proof"] as const;

/** One distinct body, keyed by the sha-256 of its exact bytes. */
export const measurementBlobTable = pgTable(
  "measurement_blob",
  {
    /** Lower-case hex sha-256 of the file's exact bytes; for a `storage` body, also its object key. */
    bodySha256: text("body_sha256").primaryKey(),
    /** The file's size in bytes, so a restore can check it wrote back what was read. */
    byteLength: integer("byte_length").notNull(),
    /** What the file's extension says it is — a hint for a reader, never used to decide placement. */
    mediaType: text("media_type").notNull(),
    placement: text("placement").notNull(),
    /** The file's contents verbatim when `placement` is `inline`; null exactly when it is `storage`. */
    body: text("body"),
    /** When the store first held this body. */
    firstImportedAt: timestamp("first_imported_at", { mode: "date", precision: 3, withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  () => [
    check("measurement_blob_sha_shape", sql`body_sha256 ~ '^[0-9a-f]{64}$'`),
    check("measurement_blob_byte_length_non_negative", sql`byte_length >= 0`),
    check("measurement_blob_placement", sql`placement in ('inline', 'storage')`),
    check("measurement_blob_body_matches_placement", sql`(placement = 'inline') = (body is not null)`),
    ...storeTablePolicies({ botRead: sql`false`, table: "measurement_blob" }),
  ],
);

/**
 * One place a body was found: a path under the home, and which of the four roots it sat under.
 *
 * `file_modified_at` is the file's mtime, which a restore writes back so an evidence tree reads in the
 * order it was taken.
 */
export const measurementLocationTable = pgTable(
  "measurement_location",
  {
    /** The file's path relative to the state home, `/`-separated. */
    relativePath: text("relative_path").notNull(),
    bodySha256: text("body_sha256")
      .notNull()
      .references(() => measurementBlobTable.bodySha256, { onDelete: "cascade" }),
    /** Which of the four roots the file sat under. */
    measurementClass: text("class").notNull(),
    fileModifiedAt: timestamp("file_modified_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One import records a path at most once, and every row it writes shares its transaction's `now()`.
    primaryKey({ columns: [table.relativePath, table.recordedAt], name: "measurement_location_pk" }),
    check("measurement_location_class", sql`class in ('bakeoff', 'datadog-shots', 'evidence', 'proof')`),
    check("measurement_location_path_shape", sql`relative_path !~ '^/' and relative_path !~ '(^|/)\\.\\.(/|$)'`),
    // `store measurement-show --ref <path>` — every version at one path, newest observation first.
    index("idx_measurement_location_path_time").on(table.relativePath, table.recordedAt.desc()),
    // `store measurement-list --class <c>`.
    index("idx_measurement_location_class").on(table.measurementClass, table.relativePath),
    index("idx_measurement_location_sha").on(table.bodySha256),
    ...storeTablePolicies({ botRead: sql`false`, table: "measurement_location" }),
  ],
);

/** A body as the database returns it. */
export type MeasurementBlobRecord = typeof measurementBlobTable.$inferSelect;

/** A body as an insert takes it. */
export type NewMeasurementBlobRecord = typeof measurementBlobTable.$inferInsert;

/** A location as the database returns it. */
export type MeasurementLocationRecord = typeof measurementLocationTable.$inferSelect;

/** A location as an insert takes it. */
export type NewMeasurementLocationRecord = typeof measurementLocationTable.$inferInsert;
