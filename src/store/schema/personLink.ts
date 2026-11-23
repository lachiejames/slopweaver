/**
 * The matches identity resolution found and refused to apply: one row per person a handle might be.
 *
 * ## Why a table rather than a stronger matcher
 *
 * Identity resolution is first-class and the archive is the
 * design; the archive's own answer to a medium-confidence match was `pending_entity_links`, a queue a
 * person reviews, and it is right for a reason worth writing down. A wrong auto-merge is INVISIBLE — two
 * people's history becomes one person's and nothing in any later query says so — while a wrong candidate
 * is a row somebody rejects. So the build in {@link ../identity/people} joins only on evidence issued by
 * an authority outside us (the same mailbox) and writes everything weaker here.
 *
 * A row records what it saw, not just how sure it was. `signals` carries the comparisons that produced
 * the score, because "0.87" tells a reviewer nothing and _"'sadie.c' resembles 'Sadie Chen'"_ tells them
 * everything they need to answer in one glance.
 */
import { index, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { LinkSignal } from "../identity/people.js";

import { contentSourceEnum } from "./enums.js";
import { personTable } from "./person.js";
import { botSeesEverything, storeTablePolicies } from "./rls.js";

/** Where a candidate link stands: waiting on a person, applied, or dismissed. */
export const linkStatusEnum = pgEnum("person_link_status", ["pending", "accepted", "rejected"]);

/**
 * One possible link between a platform identity and a person already in the store.
 *
 * The unique index is over `(person_id, source, native_id)` rather than the pair alone, because one
 * handle can plausibly be two different people and both are worth reviewing — collapsing them would hide
 * the ambiguity that is the actual finding.
 */
export const personLinkCandidateTable = pgTable(
  "person_link_candidate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => personTable.id, { onDelete: "cascade" }),
    source: contentSourceEnum("source").notNull(),
    nativeId: text("native_id").notNull(),
    handle: text("handle"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    signals: jsonb("signals").$type<LinkSignal[]>().default([]).notNull(),
    status: linkStatusEnum("status").default("pending").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    reviewedAt: timestamp("reviewed_at", { mode: "date", withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_link_candidate").on(table.personId, table.source, table.nativeId),
    index("idx_link_candidate_status").on(table.status, table.confidence.desc()),
    ...storeTablePolicies({ botRead: botSeesEverything(), table: "person_link_candidate" }),
  ],
);

/** A candidate link as the database returns it. */
export type PersonLinkCandidateRow = typeof personLinkCandidateTable.$inferSelect;

/** A candidate link as an insert takes it. */
export type NewPersonLinkCandidateRow = typeof personLinkCandidateTable.$inferInsert;
