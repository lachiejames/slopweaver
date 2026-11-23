/**
 * The places content lives: a channel, a repository, a Linear team, a Notion database, a mailbox.
 *
 * A table rather than the string column bronze carries today, because "which places does this person
 * post in" and "everything in this channel since August" are both index seeks here and neither is
 * expressible against a string that happens to match. This is half of what the owner meant by relations
 * built in; the other half is {@link ../person.personTable}.
 *
 * ## Why it is self-referencing
 *
 * A Slack thread lives inside a channel, and a channel inside a workspace. One nullable `parentId`
 * expresses both without a second table and without any depth assumption — a reader asking for a
 * channel's threads follows one edge, and a reader who does not care never sees it.
 *
 * ## Why deleting one is RESTRICTed rather than cascaded
 *
 * A container with content in it is not something any caller should be able to remove implicitly. The
 * corpus is append-mostly and its whole value is that a record stays citable; a cascade here would let
 * one mistaken delete take two million rows with it silently. A caller that genuinely means it deletes
 * the content first, which is a decision it has to write down.
 */
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { containerKindEnum, contentSourceEnum } from "./enums.js";
import { botSeesEverything, storeTablePolicies } from "./rls.js";

/**
 * Every container across every source, with the source's own id for it.
 *
 * `nativeId` is the id that source uses, kept alongside the surrogate key so an ingest can find the row
 * again without a lookup table, and so a citation can be rebuilt into a real URL.
 */
export const containerTable = pgTable(
  "container",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: contentSourceEnum("source").notNull(),
    nativeId: text("native_id").notNull(),
    kind: containerKindEnum("kind").notNull(),
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => containerTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("uq_container_source_native").on(table.source, table.nativeId),
    index("idx_container_parent").on(table.parentId),
    index("idx_container_source_kind").on(table.source, table.kind),
    ...storeTablePolicies({ botRead: botSeesEverything(), table: "container" }),
  ],
);

/** A container as the database returns it. */
export type ContainerRow = typeof containerTable.$inferSelect;

/** A container as an insert takes it. */
export type NewContainerRow = typeof containerTable.$inferInsert;
