/**
 * The owner's words as an app OUTSIDE the fleet captured them, each with the instant it was said or sent.
 *
 * `owner_turn` (`./ownerTurn.ts`) holds the `owner-turn-*.txt` files a supervisor seat wrote, and records a
 * file's write time, never when the owner spoke. Two apps on the owner's Mac keep a far longer record than the
 * fleet's own: Superwhisper keeps every dictation as `<recordings>/<epoch>/meta.json`, and Codex
 * keeps every message typed or said to an interactive thread in its own SQLite history. MEASURED: 4,379
 * non-empty dictations and 713 interactive Codex messages, against fleet stores that start much later (repro:
 * `slopweaver store import-fleet --only dictations --only codex-messages --dry-run`). The rule is to import them
 * with the time each one was said, which no existing table could hold — hence this one.
 *
 * ## One row per captured turn, keyed by where it came from
 *
 * `(source, source_id)` is the identity, unique, and every write is `DO NOTHING` on it, so a re-import over an
 * unchanged source writes zero rows. A Superwhisper `source_id` is the recording's folder name; a Codex one is
 * `<thread>/<turn>/<item>`, because Codex's own primary key is that triple — an item id alone repeats across
 * threads (42 times on the measured history).
 *
 * ## `said_at` is the source's own instant, never a file time
 *
 * Superwhisper's `datetime` (UTC, checked against the folder's epoch) and Codex's `created_at_ms`. A source with
 * no such instant does not belong in this table.
 *
 * ## `source` is text with a CHECK rather than an enum
 *
 * The same call `./ownerTurn.ts` makes for `family`: a closed set read only by equality.
 *
 * The bot is denied the table outright: the owner's dictations quote private channels and name colleagues.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { dataClassEnum } from "./enums.js";
import { storeTablePolicies } from "./rls.js";

/** One turn of the owner's an outside app captured. */
export const ownerCaptureTable = pgTable(
  "owner_capture",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Which app captured it: `superwhisper` or `codex`. */
    source: text("source").notNull(),
    /** The capturing app's own stable id for it — a recording folder, or `<thread>/<turn>/<item>`. */
    sourceId: text("source_id").notNull(),
    /** When the owner said or sent it, as the capturing app recorded it. */
    saidAt: timestamp("said_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    /** What the owner said, verbatim — never trimmed or normalised. */
    body: text("body").notNull(),
    /** Lower-case hex sha-256 of the body's UTF-8 bytes. */
    bodySha256: text("body_sha256").notNull(),
    byteLength: integer("byte_length").notNull(),
    /** The app a dictation was typed into (`cmux`, `Slack`, …), or null when the source names none. */
    targetApplication: text("target_application"),
    /** A dictation's recorded length in milliseconds. */
    durationMs: integer("duration_ms"),
    /** Codex's thread id, for a Codex message. */
    threadId: text("thread_id"),
    /** Which Codex surface the thread ran on: `cli` or `vscode`. */
    codexSurface: text("codex_surface"),
    /** Codex's own `thread_source` (`user`, `voice_chat`, …), verbatim, null where Codex stored none. */
    codexThreadSource: text("codex_thread_source"),
    /** The working directory a Codex thread ran in. */
    cwd: text("cwd"),
    /**
     * The row's data class (`../dataClass.ts`); null reads as `unknown`, which fails closed. Not sorted at write
     * yet: `store classify` (`../resolveDataClasses.ts`) writes it.
     */
    dataClass: dataClassEnum("data_class"),
    recordedAt: timestamp("recorded_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("uq_owner_capture_source_id").on(table.source, table.sourceId),
    check("owner_capture_source", sql`source in ('superwhisper', 'codex')`),
    check("owner_capture_sha_shape", sql`body_sha256 ~ '^[0-9a-f]{64}$'`),
    check("owner_capture_body_present", sql`byte_length > 0 and byte_length = octet_length(body)`),
    check(
      "owner_capture_codex_thread",
      sql`source <> 'codex' or (thread_id is not null and codex_surface is not null)`,
    ),
    // "What did I say in July" — newest first within a window.
    index("idx_owner_capture_said_at").on(table.saidAt.desc()),
    ...storeTablePolicies({ botRead: sql`false`, table: "owner_capture" }),
  ],
);

/** A captured turn as the database returns it. */
export type OwnerCaptureRecord = typeof ownerCaptureTable.$inferSelect;

/** A captured turn as an insert takes it. */
export type NewOwnerCaptureRecord = typeof ownerCaptureTable.$inferInsert;
