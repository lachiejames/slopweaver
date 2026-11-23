/**
 * How far each reader of cmux's event stream has got — and, for `session watch`, the fold it built on the way —
 * as one row per reader in the store.
 *
 * Everything in `$SLOPWEAVER_HOME` moves into the local store and the home becomes
 * deletable. `cmux-event-cursor.json` and `cmux-session-activity.json` make that trip TOGETHER, because they were
 * only ever true together: the cursor says "every event up to here is folded" and the fold is what that
 * sentence is about. Two files written one after the other could disagree after a crash between the writes —
 * a fold ahead of its cursor replays events the fold already counted, one behind it skips events nobody
 * counted. One row updated by one statement cannot. `src/cmux/eventState/storePort.ts` is the only reader and
 * writer.
 *
 * ## One row per consumer, and why `cmux events` has its own
 *
 * `session watch` and `cmux events` used to share the one cursor file, and only `session watch` wrote a fold
 * beside it — so a `cmux events` drain advanced the cursor past events `session watch` had never folded, and
 * its next run silently skipped them. Each consumer now owns its row: {@link CMUX_SESSION_WATCH_CONSUMER} carries
 * a cursor AND the fold, {@link CMUX_EVENTS_CONSUMER} a cursor alone. The CHECKs make both true by construction:
 * no third consumer, and a fold exactly where one belongs.
 *
 * `revision` is what a write pins to, an integer rather than `updated_at` because two writes inside one clock
 * tick are indistinguishable by time and a counter settles them. `cursor_seq` is a `bigint` read in number mode
 * and bounded to a JavaScript safe integer, so the column outlasts `integer` without ever answering a number
 * the reader would round.
 */
import { sql } from "drizzle-orm";
import { bigint, check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { botSeesEverything, storeTablePolicies } from "./rls.js";

/** The consumer whose row carries the cursor and the session-activity fold together. */
export const CMUX_SESSION_WATCH_CONSUMER = "session-watch";

/** The consumer whose row carries `cmux events`'s own cursor, and never a fold. */
export const CMUX_EVENTS_CONSUMER = "cmux-events";

/**
 * Each consumer's cursor, and `session watch`'s fold, beside the revision a compare-and-set pins to.
 *
 * `activities` is the fold keyed by workspace id, raw: `jsonb` is not runtime validation, so every read decodes
 * it strictly before anything reports from it.
 */
export const cmuxEventStateTable = pgTable(
  "cmux_event_state",
  {
    consumer: text("consumer").primaryKey(),
    cursorSeq: bigint("cursor_seq", { mode: "number" }).notNull(),
    activities: jsonb("activities"),
    recordedAt: timestamp("recorded_at", { mode: "date", withTimezone: true }).notNull(),
    revision: integer("revision").default(1).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check(
      "cmux_event_state_known_consumer",
      sql.raw(`consumer in ('${CMUX_SESSION_WATCH_CONSUMER}', '${CMUX_EVENTS_CONSUMER}')`),
    ),
    check(
      "cmux_event_state_fold_where_it_belongs",
      sql.raw(`(activities is not null) = (consumer = '${CMUX_SESSION_WATCH_CONSUMER}')`),
    ),
    check(
      "cmux_event_state_cursor_safe",
      sql.raw(`cursor_seq >= 0 and cursor_seq <= ${String(Number.MAX_SAFE_INTEGER)}`),
    ),
    check("cmux_event_state_revision_positive", sql`revision > 0`),
    ...storeTablePolicies({ botRead: botSeesEverything(), table: "cmux_event_state" }),
  ],
);

/** A consumer's row as the database returns it. */
export type CmuxEventStateRow = typeof cmuxEventStateTable.$inferSelect;

/** A consumer's row as an insert takes it. */
export type NewCmuxEventStateRow = typeof cmuxEventStateTable.$inferInsert;
