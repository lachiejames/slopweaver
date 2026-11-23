/**
 * The owner's words, verbatim — every `owner-turn-*.txt` a supervisor seat wrote, in the store.
 *
 * These files sit in no backup: they live under `supervisor-scratch/<handoff>/` and
 * `handovers/archive/`, and `supervisor-scratch/` is a scratch tier nothing imported. Yet they are the
 * anchors the doctrine cites (`docs/doctrine-rationale/rule-9.md` quotes `handoff-<n>/owner-turn-<m>-2.txt`), so a
 * lost file is a ruling whose wording nobody can check any more. The standing direction is that
 * everything is taken out of the user-level Slopweaver directory and put into the store.
 *
 * ## Two tables, because a body and a place are different things
 *
 * MEASURED: 30,125 such files carry only 747 distinct byte contents under 937 distinct names
 * (repro: `cd ~/.slopweaver && find supervisor-scratch handovers/archive -name 'owner-turn-*.txt' -type f |
 * wc -l`, then pipe through `xargs basename | sort -u | wc -l`, and `xargs shasum -a 256 | cut -c1-64 | sort
 * -u | wc -l` for the contents). A seat carries its predecessor's turns forward, so one utterance sits in
 * many handoff folders — and an anchor cites whichever COPY its author had open. So the body is stored once,
 * keyed by the sha-256 of its exact bytes ({@link ownerTurnTable}), and every path it was found at is a row
 * of its own ({@link ownerTurnLocationTable}); an anchor naming any copy resolves.
 *
 * ## Why the body is never trimmed, and why the key is not the voice unit id
 *
 * The record is what the owner said, byte for byte. `src/knowledge/voice/unit.ts` folds TRIMMED text into its own
 * ids, which is right for counting utterances and wrong for a record: two files differing only in a trailing
 * newline are two files, and a restore must be able to write each back exactly.
 *
 * ## `family` is text with a CHECK rather than an enum
 *
 * Two values that name WHERE a file sat, never filtered by a reader beyond equality — the same call
 * `./runs.ts` makes for `run_event.kind`, without that table's growth argument: a CHECK states the closed set
 * without minting a type the enum ratchet then has to carry.
 *
 * The bot is denied both tables outright: the owner's turns quote private channels and name colleagues.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { dataClassEnum } from "./enums.js";
import { storeTablePolicies } from "./rls.js";

/** One distinct body the owner spoke, keyed by the sha-256 of its exact bytes. */
export const ownerTurnTable = pgTable(
  "owner_turn",
  {
    /** Lower-case hex sha-256 of the file's exact bytes — never of a trimmed or normalised text. */
    bodySha256: text("body_sha256").primaryKey(),
    /** The file's contents, verbatim. */
    body: text("body").notNull(),
    /** The file's size in bytes, so a restore can check it wrote back what was read. */
    byteLength: integer("byte_length").notNull(),
    /**
     * The body's data class (`../dataClass.ts`), held once per body like everything else here; null reads as
     * `unknown`, which fails closed. Never backfilled.
     */
    dataClass: dataClassEnum("data_class"),
    /** When the store first held this body. Not when the owner said it: that is `file_modified_at` at best. */
    firstImportedAt: timestamp("first_imported_at", { mode: "date", precision: 3, withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  () => [
    check("owner_turn_sha_shape", sql`body_sha256 ~ '^[0-9a-f]{64}$'`),
    check("owner_turn_byte_length_non_negative", sql`byte_length >= 0`),
    ...storeTablePolicies({ botRead: sql`false`, table: "owner_turn" }),
  ],
);

/**
 * One place a body was found: a path under the home, and the turn label its filename carries.
 *
 * `turn` is NOT unique — the same label sits in every handoff folder a seat carried it into, and a label
 * re-used for a corrected text is two bodies under one name. `file_modified_at` is the file's mtime, which
 * is when a seat last WROTE it, not when the owner spoke; the `at:` header some files carry is a follow-up.
 */
export const ownerTurnLocationTable = pgTable(
  "owner_turn_location",
  {
    /** The file's path relative to the state home, `/`-separated. */
    relativePath: text("relative_path").notNull(),
    bodySha256: text("body_sha256")
      .notNull()
      .references(() => ownerTurnTable.bodySha256, { onDelete: "cascade" }),
    /** The filename minus `owner-turn-` and `.txt`, verbatim: `owner-turn-<turn>.archive.txt` → `<turn>.archive`. */
    turn: text("turn").notNull(),
    /** Which of the two roots the file sat under. */
    family: text("family").notNull(),
    fileModifiedAt: timestamp("file_modified_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // A re-import of an unchanged file is a conflict on this key and writes nothing; an EDITED file is a new
    // body at the same path, so both versions stay — the record is append-only by construction.
    primaryKey({ columns: [table.relativePath, table.bodySha256], name: "owner_turn_location_pk" }),
    check("owner_turn_location_family", sql`family in ('archive-turn', 'scratch-turn')`),
    // `owner-turn-show --ref <turn>` — every copy of one turn, newest write first.
    index("idx_owner_turn_location_turn_time").on(table.turn, table.fileModifiedAt.desc()),
    index("idx_owner_turn_location_sha").on(table.bodySha256),
    ...storeTablePolicies({ botRead: sql`false`, table: "owner_turn_location" }),
  ],
);

/** A body as the database returns it. */
export type OwnerTurnRecord = typeof ownerTurnTable.$inferSelect;

/** A body as an insert takes it. */
export type NewOwnerTurnRecord = typeof ownerTurnTable.$inferInsert;

/** A location as the database returns it. */
export type OwnerTurnLocationRecord = typeof ownerTurnLocationTable.$inferSelect;

/** A location as an insert takes it. */
export type NewOwnerTurnLocationRecord = typeof ownerTurnLocationTable.$inferInsert;
