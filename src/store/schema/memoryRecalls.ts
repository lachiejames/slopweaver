/**
 * The recall ledger — every time a memory was pulled into a piece of work, and whether it held.
 *
 * Recall accounting: if the memory still holds, that strengthens it; if it does not hold this time, that is
 * important to know, a possibly false memory. Nothing is ever deleted.
 *
 * ## Why it is a second table rather than columns on `memories`
 *
 * `memories` is a log of RECORDINGS: one row is what somebody believed at an instant, and nothing updates
 * one in place — `./memories.ts` says why, and the repeat count the owner's consolidation trigger reads is
 * made of that. A recall count kept ON that row would have to be mutated, which is the one write that
 * table does not have. So a recall is its own append-only row, joined by the CLAIM id, and every count a
 * reader wants is an aggregate over this table rather than a number somebody maintains.
 *
 * ## Nothing is ever deleted, and that is the whole retention policy
 *
 * There is no delete path and no sweep anywhere in this codebase for either table. Retention is EARNED by
 * use in the sense that `../../knowledge/recall.ts`'s page puts a claim that has been recalled and held in
 * front of one nobody has ever pulled — a reordering, never a narrowing. A memory that stops being useful
 * sinks; it does not disappear, because the owner's own worry about ageing out something useful is the
 * reason the mechanism exists at all.
 */
import { sql } from "drizzle-orm";
import { bigserial, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { RecallOutcome } from "../../knowledge/recallAccounting.js";

import { storeTablePolicies } from "./rls.js";

/** Every recall outcome, as the tuple `pgEnum` requires. `./memories.ts` says why a tuple lives here. */
const RECALL_OUTCOME_VALUES = ["held", "broke", "unchecked"] as const satisfies readonly RecallOutcome[];

/** What an investigation found when it checked a memory it had just recalled. */
export const recallOutcomeEnum = pgEnum("recall_outcome", RECALL_OUTCOME_VALUES);

/**
 * One recall: which claim was pulled, which recording was read, and what checking it established.
 *
 * `memoryId` is the CLAIM id rather than the recording id so the counts survive a regrade — a claim that
 * was recalled, broke, and was re-recorded is one claim with a history, which is exactly what the reader
 * wants ranked. `recordingId` is kept beside it so a row still says which text was actually read.
 */
export const memoryRecallsTable = pgTable(
  "memory_recalls",
  {
    recallId: uuid("recall_id").primaryKey().defaultRandom(),
    /** Write order, and the tie-break between two recalls at the same instant. `./memories.ts`'s reason. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    /** The claim that was recalled. Not a foreign key: a claim id is deliberately not unique in `memories`. */
    memoryId: text("memory_id").notNull(),
    /** The physical recording the session actually read. */
    recordingId: uuid("recording_id").notNull(),
    outcome: recallOutcomeEnum("outcome").notNull(),
    /** What the checking session observed. What makes `held` a measurement rather than a vote. */
    evidence: text("evidence").notNull(),
    /** The board row the recalling session was on, or `ad-hoc`. */
    run: text("run").notNull(),
    recordedAt: timestamp("recorded_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // The count read: every recall of one claim, newest first.
    index("idx_memory_recalls_memory_time").on(table.memoryId, table.recordedAt.desc()),
    // "What has this run checked" — the accounting a session reports at the end of a wave.
    index("idx_memory_recalls_run_time").on(table.run, table.recordedAt.desc()),
    // A memory's evidence can quote a private channel and a recall carries more of it, so the Slack-facing
    // role is denied outright, exactly as `./memories.ts` denies it.
    ...storeTablePolicies({ botRead: sql`false`, table: "memory_recalls" }),
  ],
);

/** One recall as the database returns it. */
export type MemoryRecallRow = typeof memoryRecallsTable.$inferSelect;
