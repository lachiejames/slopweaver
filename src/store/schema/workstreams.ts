/**
 * The workstream register in the store: one row per workstream, its own milestones and the edges between them, its
 * dated entries, its links, and one register-level document.
 *
 * Workstreams are a table
 * with rows, not files, each first-class — linked to queue cards, alignment cards, automations and pull requests.
 * `src/workstreams/store/` is the only reader and writer, and `docs/store/workstreams.md` carries the reasoning.
 *
 * ## What the database enforces, and what the port does
 *
 * Every child row carries `workstream_id`, and every reference to a milestone is the composite `(workstream_id,
 * milestone_id)`, so an edge, an entry or a link can never name ANOTHER workstream's milestone. An entry's and a link's
 * own key is `(workstream_id, id)` too, never the caller's UUID alone: a table-wide key let two writers that swapped
 * ids between workstreams each wait on the other's uncommitted delete, a deadlock. A `done` entry carries
 * its milestone and its proof link by CHECK. What a CHECK cannot see across rows — a cycle, every milestone reaching
 * the definition of done, a milestone finished before its predecessors, a `workstream` link naming a workstream that
 * exists — `src/workstreams/store/validation.ts` refuses before any write.
 *
 * ## Why `detail` is a document
 *
 * The authored fields nothing queries by (feedback, people, priority, the gauge…) differ per kind; normalising them
 * would add a table per field and buy no lookup. `$type` is the writer's convenience only: every read decodes `detail`
 * against its kind (`src/workstreams/store/decode.ts`).
 *
 * The bot reads none of it (`botRead: false`): every row quotes colleagues and links internal threads.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  WORKSTREAM_ENTRY_KINDS,
  WORKSTREAM_KINDS,
  WORKSTREAM_LINK_KINDS,
  WORKSTREAM_STATUSES,
  WORKSTREAM_WORKSPACES,
  type WorkstreamRegisterMeta,
} from "../../workstreams/store/types.js";

import { storeTablePolicies } from "./rls.js";

/** The only primary-key value `workstream_register_meta` accepts, spelled once so a reader and the CHECK agree. */
export const WORKSTREAM_REGISTER_META_ID = "workstreams";

/** A lower-kebab id, the grammar of a workstream and of a milestone. */
const KEBAB = "^[a-z0-9]+(-[a-z0-9]+)*$";

/** A workstream's variant. */
export const workstreamKindEnum = pgEnum("workstream_kind", WORKSTREAM_KINDS);

/** Which workspace a workstream belongs to. */
export const workstreamWorkspaceEnum = pgEnum("workstream_workspace", WORKSTREAM_WORKSPACES);

/** The owner's four status words. */
export const workstreamStatusEnum = pgEnum("workstream_status", WORKSTREAM_STATUSES);

/** What kind of moment an entry is. */
export const workstreamEntryKindEnum = pgEnum("workstream_entry_kind", WORKSTREAM_ENTRY_KINDS);

/** What a link points at. */
export const workstreamLinkKindEnum = pgEnum("workstream_link_kind", WORKSTREAM_LINK_KINDS);

/** One workstream: the columns something reads by, the rest in `detail`, and the revision a write pins to. */
export const workstreamTable = pgTable(
  "workstream",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: workstreamKindEnum("kind").notNull(),
    workspace: workstreamWorkspaceEnum("workspace").notNull(),
    outcome: text("outcome"),
    status: workstreamStatusEnum("status"),
    detail: jsonb("detail").$type<Readonly<Record<string, unknown>>>().notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("workstream_id_kebab", sql.raw(`id ~ '${KEBAB}'`)),
    check("workstream_name_present", sql`name <> ''`),
    check("workstream_revision_positive", sql`revision > 0`),
    check(
      "workstream_kind_columns",
      sql`(kind in ('outcome', 'standing') and outcome is not null and status is not null) or (kind = 'linked' and outcome is not null and status is null) or (kind = 'local' and outcome is null and status is null) or (kind = 'closing' and status is null)`,
    ),
    ...storeTablePolicies({ botRead: sql`false`, table: "workstream" }),
  ],
);

/** The register-level document, a singleton beside the revision a compare-and-set pins to. */
export const workstreamRegisterMetaTable = pgTable(
  "workstream_register_meta",
  {
    id: text("id").primaryKey(),
    document: jsonb("document").$type<WorkstreamRegisterMeta>().notNull(),
    revision: integer("revision").default(1).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("workstream_register_meta_is_singleton", sql.raw(`id = '${WORKSTREAM_REGISTER_META_ID}'`)),
    check("workstream_register_meta_revision_positive", sql`revision > 0`),
    ...storeTablePolicies({ botRead: sql`false`, table: "workstream_register_meta" }),
  ],
);

/** One of a workstream's own milestones, in authored order; the greatest position is its definition of done. */
export const workstreamMilestoneTable = pgTable(
  "workstream_milestone",
  {
    workstreamId: text("workstream_id")
      .notNull()
      .references(() => workstreamTable.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    name: text("name").notNull(),
    anchor: text("anchor").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workstreamId, table.id], name: "pk_workstream_milestone" }),
    unique("uq_workstream_milestone_position").on(table.workstreamId, table.position),
    check("workstream_milestone_id_kebab", sql.raw(`id ~ '${KEBAB}'`)),
    check("workstream_milestone_name_present", sql`name <> '' and anchor <> ''`),
    check("workstream_milestone_position", sql`position >= 0`),
    ...storeTablePolicies({ botRead: sql`false`, table: "workstream_milestone" }),
  ],
);

/** One `after` edge: `milestone_id` comes after `after_id`, both of the same workstream by construction. */
export const workstreamMilestoneAfterTable = pgTable(
  "workstream_milestone_after",
  {
    workstreamId: text("workstream_id").notNull(),
    milestoneId: text("milestone_id").notNull(),
    afterId: text("after_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workstreamId, table.milestoneId, table.afterId],
      name: "pk_workstream_milestone_after",
    }),
    foreignKey({
      columns: [table.workstreamId, table.milestoneId],
      foreignColumns: [workstreamMilestoneTable.workstreamId, workstreamMilestoneTable.id],
      name: "fk_workstream_milestone_after_milestone",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.workstreamId, table.afterId],
      foreignColumns: [workstreamMilestoneTable.workstreamId, workstreamMilestoneTable.id],
      name: "fk_workstream_milestone_after_after",
    }).onDelete("cascade"),
    check("workstream_milestone_after_not_self", sql`milestone_id <> after_id`),
    ...storeTablePolicies({ botRead: sql`false`, table: "workstream_milestone_after" }),
  ],
);

/** One dated entry in a workstream's story; finishing a milestone needs the milestone and the proof link. */
export const workstreamEntryTable = pgTable(
  "workstream_entry",
  {
    id: uuid("id").notNull(),
    workstreamId: text("workstream_id")
      .notNull()
      .references(() => workstreamTable.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    kind: workstreamEntryKindEnum("kind").notNull(),
    text: text("text").notNull(),
    href: text("href"),
    milestoneId: text("milestone_id"),
    done: boolean("done").default(false).notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workstreamId, table.id], name: "pk_workstream_entry" }),
    unique("uq_workstream_entry_position").on(table.workstreamId, table.position),
    foreignKey({
      columns: [table.workstreamId, table.milestoneId],
      foreignColumns: [workstreamMilestoneTable.workstreamId, workstreamMilestoneTable.id],
      name: "fk_workstream_entry_milestone",
    }),
    check("workstream_entry_text_present", sql`text <> ''`),
    check("workstream_entry_position", sql`position >= 0`),
    check("workstream_entry_done_proven", sql`not done or (milestone_id is not null and href is not null)`),
    ...storeTablePolicies({ botRead: sql`false`, table: "workstream_entry" }),
  ],
);

/** One link from a workstream to something it owns or bears on, optionally serving one of its milestones. */
export const workstreamLinkTable = pgTable(
  "workstream_link",
  {
    id: uuid("id").notNull(),
    workstreamId: text("workstream_id")
      .notNull()
      .references(() => workstreamTable.id, { onDelete: "cascade" }),
    kind: workstreamLinkKindEnum("kind").notNull(),
    target: text("target").notNull(),
    label: text("label"),
    milestoneId: text("milestone_id"),
  },
  (table) => [
    primaryKey({ columns: [table.workstreamId, table.id], name: "pk_workstream_link" }),
    unique("uq_workstream_link_target").on(table.workstreamId, table.kind, table.target),
    foreignKey({
      columns: [table.workstreamId, table.milestoneId],
      foreignColumns: [workstreamMilestoneTable.workstreamId, workstreamMilestoneTable.id],
      name: "fk_workstream_link_milestone",
    }),
    check("workstream_link_target_present", sql`target <> '' and (label is null or label <> '')`),
    ...storeTablePolicies({ botRead: sql`false`, table: "workstream_link" }),
  ],
);

/** A workstream row as the database returns it. */
export type WorkstreamRow = typeof workstreamTable.$inferSelect;
/** The register-level row as the database returns it. */
export type WorkstreamRegisterMetaRow = typeof workstreamRegisterMetaTable.$inferSelect;
/** A milestone row as the database returns it. */
export type WorkstreamMilestoneRow = typeof workstreamMilestoneTable.$inferSelect;
/** An `after` edge as the database returns it. */
export type WorkstreamMilestoneAfterRow = typeof workstreamMilestoneAfterTable.$inferSelect;
/** An entry row as the database returns it. */
export type WorkstreamEntryRow = typeof workstreamEntryTable.$inferSelect;
/** A link row as the database returns it. */
export type WorkstreamLinkRow = typeof workstreamLinkTable.$inferSelect;
