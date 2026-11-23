/**
 * A store export staged for import: the rows it carried, the questions its plan raised, and the owner's
 * answer to each, held in the store so nothing about an import lives under a home directory.
 *
 * ## Nothing here is live
 *
 * A staged row is a COPY the export carried, never a row the fleet reads. The live tables are untouched until
 * a later apply takes each staged row by the answer its question got, so a restored instruction stays
 * inactive until the owner says otherwise and a conflict is never settled by assumption.
 *
 * ## The database refuses what the verbs refuse
 *
 * Every vocabulary is a typed `text` column with a CHECK rather than a Postgres enum, so a vocabulary already
 * closed in TypeScript needs no `ALTER TYPE` to change. The checks are not decoration: a question's kind fixes
 * whether it shows a live side, and a resolution's composite key to `(id, kind)` lets one CHECK tie its action
 * to that kind, so an answer the question does not take cannot be stored even by a caller that skips the
 * CLI's own validation.
 *
 * ## The source directory is not recorded
 *
 * A batch is self-sufficient: an item holds its whole decoded row as `payload`, so the export directory can
 * disappear between staging and applying. A part row records each part the export CARRIED, an empty one included,
 * so an apply can tell a part with no rows from a part the export never had, and an item can only name a carried
 * part.
 *
 * ## An application is a receipt, written once
 *
 * `store_import_application` is the one row an apply writes last, in the transaction that made the batch live, so
 * a second apply finds it and writes nothing and a crash leaves no receipt beside half a batch. It names the plan it
 * applied, which must be its batch's own, and a batch holding one is never removed. The bot is denied all six
 * tables, as it is every judgement table.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type { ImportAction, ImportQuestion } from "../transfer/compare.js";
import { STORE_EXPORT_PARTS, type StoreExportPartKind } from "../transfer/parts.js";
import type { JsonValue } from "../transfer/retained.js";

import { storeTablePolicies } from "./rls.js";

/** Every part kind, as the SQL list a CHECK reads. */
const PART_KINDS_SQL = STORE_EXPORT_PARTS.map((spec) => `'${spec.kind}'`).join(", ");

/**
 * One export staged once under one plan: the pair is unique, so staging the same export under the same plan twice is
 * one batch, while the same export planned against a store that has since moved stages as a batch of its own.
 */
export const storeImportBatchTable = pgTable(
  "store_import_batch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentDigest: text("content_digest").notNull(),
    /** The plan the owner approved: what the live store looked like when the batch was staged. */
    planDigest: text("plan_digest").notNull(),
    /**
     * The comparison rules the plan was made by (`STORE_IMPORT_COMPARISON_VERSION`). Null on a batch staged before
     * batches recorded it, which is never read as current: nothing infers or backfills a version.
     */
    comparisonVersion: integer("comparison_version"),
    /** Whether the export carried a manifest, or was read at the part file names only. */
    manifested: boolean("manifested").notNull(),
    stagedAt: timestamp("staged_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("uq_store_import_batch_content_plan").on(table.contentDigest, table.planDigest),
    // The key an application receipt names its batch AND plan by, so a receipt cannot name a plan its batch never had.
    unique("uq_store_import_batch_plan").on(table.id, table.planDigest),
    check("store_import_batch_content_digest", sql`content_digest ~ '^sha256:[0-9a-f]{64}$'`),
    check("store_import_batch_plan_digest", sql`plan_digest ~ '^sha256:[0-9a-f]{64}$'`),
    check("store_import_batch_comparison_version", sql`comparison_version is null or comparison_version > 0`),
    ...storeTablePolicies({ botRead: sql`false`, table: "store_import_batch" }),
  ],
);

/** One part a staged export carried, rows or none: a part with no row here is one the export did not have. */
export const storeImportPartTable = pgTable(
  "store_import_part",
  {
    batchId: uuid("batch_id")
      .notNull()
      .references(() => storeImportBatchTable.id, { onDelete: "cascade" }),
    part: text("part").$type<StoreExportPartKind>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.batchId, table.part], name: "store_import_part_pk" }),
    check("store_import_part_part", sql.raw(`part in (${PART_KINDS_SQL})`)),
    ...storeTablePolicies({ botRead: sql`false`, table: "store_import_part" }),
  ],
);

/** One row an export carried, keyed the way its part's own domain keys it, its decoded row whole. */
export const storeImportItemTable = pgTable(
  "store_import_item",
  {
    batchId: uuid("batch_id")
      .notNull()
      .references(() => storeImportBatchTable.id, { onDelete: "cascade" }),
    /** A part the batch carried: the key to {@link storeImportPartTable} refuses one it did not. */
    part: text("part").$type<StoreExportPartKind>().notNull(),
    itemKey: text("item_key").notNull(),
    /** The row's position in its part, so an apply takes rows in the order the export held them. */
    ordinal: integer("ordinal").notNull(),
    payload: jsonb("payload").$type<JsonValue>().notNull(),
    fingerprint: text("fingerprint").notNull(),
    summary: text("summary").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.batchId, table.part, table.itemKey], name: "store_import_item_pk" }),
    foreignKey({
      columns: [table.batchId, table.part],
      foreignColumns: [storeImportPartTable.batchId, storeImportPartTable.part],
      name: "fk_store_import_item_part",
    }).onDelete("cascade"),
    unique("uq_store_import_item_ordinal").on(table.batchId, table.part, table.ordinal),
    check("store_import_item_part", sql.raw(`part in (${PART_KINDS_SQL})`)),
    check("store_import_item_ordinal", sql`ordinal >= 0`),
    check("store_import_item_fingerprint", sql`fingerprint ~ '^sha256:[0-9a-f]{64}$'`),
    ...storeTablePolicies({ botRead: sql`false`, table: "store_import_item" }),
  ],
);

/** One question a staged row raised: at most one per row, its kind deciding the answers it takes. */
export const storeImportQuestionTable = pgTable(
  "store_import_question",
  {
    id: text("id").primaryKey(),
    batchId: uuid("batch_id").notNull(),
    part: text("part").$type<StoreExportPartKind>().notNull(),
    itemKey: text("item_key").notNull(),
    kind: text("kind").$type<ImportQuestion["kind"]>().notNull(),
    importedSummary: text("imported_summary").notNull(),
    /**
     * The live row's line for a conflict or an alignment; an activation asks about a row the store does not hold. An
     * alignment is a conflict on an append-only part, whose live row is kept and whose one answer is `keep-current`.
     */
    liveSummary: text("live_summary"),
    createdAt: timestamp("created_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.batchId, table.part, table.itemKey],
      foreignColumns: [storeImportItemTable.batchId, storeImportItemTable.part, storeImportItemTable.itemKey],
      name: "fk_store_import_question_item",
    }).onDelete("cascade"),
    unique("uq_store_import_question_item").on(table.batchId, table.part, table.itemKey),
    unique("uq_store_import_question_kind").on(table.id, table.kind),
    check("store_import_question_id", sql`id ~ '^import-q-[0-9a-f]{16}$'`),
    check(
      "store_import_question_kind",
      sql`(kind = 'activation' and live_summary is null) or (kind in ('conflict', 'alignment') and live_summary is not null)`,
    ),
    ...storeTablePolicies({ botRead: sql`false`, table: "store_import_question" }),
  ],
);

/**
 * The owner's one answer to one question. Immutable: a second, different answer is refused, never written, and an
 * UPDATE, DELETE, cascade or TRUNCATE is refused by {@link IMPORT_STAGING_TRIGGERS}.
 */
export const storeImportResolutionTable = pgTable(
  "store_import_resolution",
  {
    questionId: text("question_id").primaryKey(),
    questionKind: text("question_kind").$type<ImportQuestion["kind"]>().notNull(),
    action: text("action").$type<ImportAction>().notNull(),
    resolvedAt: timestamp("resolved_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.questionId, table.questionKind],
      foreignColumns: [storeImportQuestionTable.id, storeImportQuestionTable.kind],
      name: "fk_store_import_resolution_question",
    }).onDelete("cascade"),
    check(
      "store_import_resolution_action",
      sql`(question_kind = 'activation' and action in ('activate', 'leave-inactive')) or (question_kind = 'conflict' and action in ('keep-current', 'take-imported')) or (question_kind = 'alignment' and action = 'keep-current')`,
    ),
    ...storeTablePolicies({ botRead: sql`false`, table: "store_import_resolution" }),
  ],
);

/**
 * The receipt of one applied batch, inserted last in the transaction that made it live. Immutable, and never written
 * twice for a batch: its batch is its key. A batch holding one is never removed.
 */
export const storeImportApplicationTable = pgTable(
  "store_import_application",
  {
    batchId: uuid("batch_id").primaryKey(),
    /** The plan the apply re-derived and made live, which must be its batch's own. */
    planDigest: text("plan_digest").notNull(),
    /** Every row the application's transaction wrote, this receipt included. */
    writeCount: integer("write_count").notNull(),
    appliedAt: timestamp("applied_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.batchId, table.planDigest],
      foreignColumns: [storeImportBatchTable.id, storeImportBatchTable.planDigest],
      name: "fk_store_import_application_batch",
    }).onDelete("restrict"),
    check("store_import_application_plan_digest", sql`plan_digest ~ '^sha256:[0-9a-f]{64}$'`),
    check("store_import_application_write_count", sql`write_count > 0`),
    ...storeTablePolicies({ botRead: sql`false`, table: "store_import_application" }),
  ],
);

/** The four tables staging fills, each row of which an apply later reads as what the owner approved. */
const STAGED_TABLES = [
  "store_import_batch",
  "store_import_part",
  "store_import_item",
  "store_import_question",
] as const;

/** The staged tables whose rows belong to a batch: added only while it is staged, removed only with it whole. */
const BATCH_ROW_TABLES = ["store_import_part", "store_import_item", "store_import_question"] as const;

/** The two tables written once and never changed: an answer, and an application's receipt. */
const RECORD_TABLES = ["store_import_resolution", "store_import_application"] as const;

/** One trigger the staging tables carry: its name, its table, and the clause that fires it. */
export interface ImportStagingTrigger {
  readonly name: string;
  readonly table: string;
  /** Everything after `create trigger <name>`: the timing, the event, the table and the function. */
  readonly fires: string;
}

/**
 * Every trigger that keeps staged rows, recorded answers and application receipts as they were written, named so a
 * test and a migration can find each one. A batch is SEALED when the transaction staging it commits: a part, item or
 * question is inserted only by the transaction that inserted its batch, so nothing is ever appended to a batch already
 * staged. A recorded answer or receipt is never updated or deleted. A staged row is never updated, since staging only
 * inserts. A part, item or question is removed only with its whole batch, and a batch holding an answer is never
 * removed, so re-staging the same export can never re-ask an answered question; a batch holding a receipt is kept by
 * the receipt's own `restrict` key. None of the six tables is ever truncated, and none is written in replica mode,
 * where the foreign keys that cascade a batch's removal and tie an answer to its question are not enforced.
 */
export const IMPORT_STAGING_TRIGGERS: readonly ImportStagingTrigger[] = [
  ...RECORD_TABLES.map((table): ImportStagingTrigger => ({
    fires: `before update or delete on public.${table} for each row execute function public.${table}_immutable()`,
    name: `trg_${table}_immutable`,
    table,
  })),
  ...BATCH_ROW_TABLES.map((table): ImportStagingTrigger => ({
    fires: `before insert on public.${table} for each row execute function public.store_import_batch_sealed()`,
    name: `trg_${table}_sealed`,
    table,
  })),
  ...STAGED_TABLES.map((table): ImportStagingTrigger => ({
    fires: `before update on public.${table} for each row execute function public.store_import_staged_unchanged()`,
    name: `trg_${table}_unchanged`,
    table,
  })),
  {
    fires: `before delete on public.store_import_batch for each row execute function public.store_import_answered_batch_kept()`,
    name: "trg_store_import_batch_answered_kept",
    table: "store_import_batch",
  },
  ...BATCH_ROW_TABLES.map((table): ImportStagingTrigger => ({
    fires: `before delete on public.${table} for each row execute function public.store_import_staged_whole()`,
    name: `trg_${table}_whole`,
    table,
  })),
  ...[...STAGED_TABLES, ...RECORD_TABLES].map((table): ImportStagingTrigger => ({
    fires: `before truncate on public.${table} for each statement execute function public.store_import_no_truncate()`,
    name: `trg_${table}_no_truncate`,
    table,
  })),
  ...[...STAGED_TABLES, ...RECORD_TABLES].map((table): ImportStagingTrigger => ({
    fires: `before insert or update or delete on public.${table} for each row execute function public.store_import_keys_enforced()`,
    name: `trg_${table}_keys_enforced`,
    table,
  })),
];

/**
 * The functions {@link IMPORT_STAGING_TRIGGERS} execute, each replaced idempotently before any trigger names it. Each
 * runs with an empty `search_path` and names every table `public.`: resolved by bare name, a session's own temporary
 * table of the same name would shadow the real one, and a guard reading an empty temporary batch table would let a
 * row be removed from a batch still standing.
 */
const IMPORT_STAGING_FUNCTIONS: readonly string[] = [
  `create or replace function public.store_import_resolution_immutable() returns trigger language plpgsql set search_path = '' as $$
      begin
        raise exception 'store import answer % is recorded and is never changed', old.question_id;
      end $$`,
  `create or replace function public.store_import_application_immutable() returns trigger language plpgsql set search_path = '' as $$
      begin
        raise exception 'store import batch % is applied, and its receipt is never changed', old.batch_id;
      end $$`,
  // `xmin` is the inserting transaction's id; staging writes in ONE top-level transaction with no savepoint, whose
  // id is exactly `pg_current_xact_id()`, so a batch matches only inside the transaction that staged it. `xmin` is 32
  // bits and is reused after wraparound, so the batch's `staged_at` — `now()`, this transaction's start, at the
  // column's millisecond precision — must match too; a staged batch's `staged_at` is never updated.
  `create or replace function public.store_import_batch_sealed() returns trigger language plpgsql set search_path = '' as $$
      begin
        if not exists (
          select 1 from public.store_import_batch b
            where b.id = new.batch_id
              and b.xmin = pg_current_xact_id()::xid
              and b.staged_at = now()::timestamptz(3)
        ) then
          raise exception 'store import batch % is sealed: a % row is added only while the batch is staged', new.batch_id, tg_table_name;
        end if;
        return new;
      end $$`,
  `create or replace function public.store_import_staged_unchanged() returns trigger language plpgsql set search_path = '' as $$
      begin
        raise exception 'a staged % row is never changed: staging only inserts', tg_table_name;
      end $$`,
  `create or replace function public.store_import_answered_batch_kept() returns trigger language plpgsql set search_path = '' as $$
      begin
        if exists (
          select 1 from public.store_import_resolution r
            join public.store_import_question q on q.id = r.question_id
            where q.batch_id = old.id
        ) then
          raise exception 'store import batch % holds a recorded answer, so it is never removed', old.id;
        end if;
        return old;
      end $$`,
  // The cascade from a batch's delete runs after that batch row is gone, so a row whose batch still stands is being
  // removed on its own, which would leave a batch the content digest then reports as already staged.
  `create or replace function public.store_import_staged_whole() returns trigger language plpgsql set search_path = '' as $$
      begin
        if exists (select 1 from public.store_import_batch b where b.id = old.batch_id) then
          raise exception 'a staged % row is removed only with its whole batch %', tg_table_name, old.batch_id;
        end if;
        return old;
      end $$`,
  `create or replace function public.store_import_no_truncate() returns trigger language plpgsql set search_path = '' as $$
      begin
        raise exception '% is never truncated: a staged import is kept as it was written', tg_table_name;
      end $$`,
  // Postgres's own foreign-key triggers fire in origin mode only, so in replica mode a batch's delete cascades to
  // nothing and an answer's insert checks no question: every write waits for the keys to be enforced again.
  `create or replace function public.store_import_keys_enforced() returns trigger language plpgsql set search_path = '' as $$
      begin
        if current_setting('session_replication_role') = 'replica' then
          raise exception '% is written only with its foreign keys enforced, never in session_replication_role replica', tg_table_name;
        end if;
        if tg_op = 'DELETE' then
          return old;
        end if;
        return new;
      end $$`,
];

/**
 * The statements that keep a staged import as it was written in the database itself, not only in the verbs, whoever
 * issues the statement: every function, then each trigger by `create or replace trigger`. One statement per trigger,
 * never a drop and a create: between those two a re-apply would leave a window, or a crash a gap, with no guard.
 * Every function and table is named `public.`: the apply runs these on whatever `search_path` its connection
 * carries, and a bare name would install a guard on the first look-alike table that path finds.
 *
 * Each trigger is then `enable always` in the SAME statement, a `do` block, so it is never left firing in origin mode
 * only. An ordinary trigger does not fire for a session that sets `session_replication_role = replica`, and the
 * store's own role may set it — MEASURED on the local stack, where `postgres` is no superuser:
 * `psql postgresql://postgres:postgres@127.0.0.1:55322/postgres -c "set session_replication_role = replica"` answers
 * `SET`.
 *
 * @returns the statements a migration runs, in order, to install every staging trigger idempotently
 */
export const IMPORT_STAGING_IMMUTABLE_STATEMENTS: readonly string[] = [
  ...IMPORT_STAGING_FUNCTIONS,
  ...IMPORT_STAGING_TRIGGERS.map(
    (trigger) =>
      `do $$ begin
        create or replace trigger ${trigger.name} ${trigger.fires};
        alter table public.${trigger.table} enable always trigger ${trigger.name};
      end $$`,
  ),
];

/**
 * Which staging triggers a store lacks, given the always-enabled triggers it reports. The migration commits the
 * tables before the apply's guard phase installs these, so an apply that never finished leaves the tables
 * unguarded; a verb that writes to them asks this first rather than write into that state. A trigger disabled, or
 * reset to fire in origin mode only, is missing too: a replica-mode session would not fire it.
 *
 * @param installed every trigger the store reports enabled ALWAYS, by table and name
 * @returns the names of the staging triggers absent from it, in declaration order; empty when every one is there
 */
export function missingStagingTriggers({
  installed,
}: {
  installed: readonly { table: string; name: string }[];
}): readonly string[] {
  const present = new Set(installed.map((trigger) => `${trigger.table}.${trigger.name}`));
  return IMPORT_STAGING_TRIGGERS.filter((trigger) => !present.has(`${trigger.table}.${trigger.name}`)).map(
    (trigger) => trigger.name,
  );
}

/** A staged batch as the database returns it. */
export type StoreImportBatchRow = typeof storeImportBatchTable.$inferSelect;

/** A carried part as the database returns it. */
export type StoreImportPartRow = typeof storeImportPartTable.$inferSelect;

/** An application receipt as the database returns it. */
export type StoreImportApplicationRow = typeof storeImportApplicationTable.$inferSelect;

/** A staged item as the database returns it. */
export type StoreImportItemRow = typeof storeImportItemTable.$inferSelect;

/** A staged question as the database returns it. */
export type StoreImportQuestionRow = typeof storeImportQuestionTable.$inferSelect;

/** A recorded answer as the database returns it. */
export type StoreImportResolutionRow = typeof storeImportResolutionTable.$inferSelect;
