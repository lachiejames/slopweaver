/**
 * The unified content table: every record from every source, one row shape, one `source` discriminator.
 *
 * One table with a `source` discriminator is the right shape, as in the archive that is the reference: it
 * had discriminated unions built into the types and the schema because the types are derived from the
 * schema, which made it fully type safe. If source is slack, a record requires a channel field; if source
 * is linear, it requires a team field.
 *
 * ## Where the per-source shape lives, and why it is off this table
 *
 * A source's required field is not a key of a `metadata` jsonb with Postgres checking for its
 * presence (`metadata ? 'channel'`). The schema aligns with the reality of what a platform gives us, as
 * real columns in a proper table, which keeps the generated types much cleaner. So a Slack row's channel is
 * `content_slack.channel_id`, `NOT NULL` and indexed, and the
 * presence check it replaces is {@link ../sourceRows.SOURCE_ROW_PRESENCE_STATEMENTS}.
 *
 * What stays here is what is genuinely source-neutral. `metadata` still exists and is much smaller: the
 * record's cross-references, plus whatever of its projected attributes no per-source column claimed. The
 * full source payload is GONE — see {@link ../sourceRows} for the measurement that decided it.
 *
 * ## The unique key that looks redundant and is not
 *
 * `uq_content_id_source` duplicates the primary key's own uniqueness. It exists so the per-source tables
 * can carry a COMPOSITE foreign key onto `(id, source)`, which is what makes attaching a `content_slack`
 * row to a GitHub content row a database refusal rather than a review note. Postgres requires a unique
 * constraint over exactly the referenced column list, and the primary key over `id` alone is not one.
 *
 * ## Why it is a CONSTRAINT and not a `uniqueIndex`, which is not a style choice
 *
 * `drizzle-kit generate` emits a migration in phases: every `CREATE TABLE`, then every `ALTER TABLE … ADD
 * CONSTRAINT`, then every `CREATE INDEX`. A `uniqueIndex` lands in the LAST phase and the four composite
 * foreign keys that reference it land in the middle one, so within one generated file the key is
 * referenced before it exists. MEASURED while squashing the journal to a single `0000`
 * — applying it to an empty database stops at the first side table with
 * `ERROR: there is no unique constraint matching given keys for referenced table "content"`. The six-file
 * history hid this for as long as it lasted, because the index came from an earlier migration than the
 * foreign keys and no single file ever had to order the two. Reproduce on any tree:
 * `dropdb squash_proof; createdb squash_proof; psql -v ON_ERROR_STOP=1 -d squash_proof -f supabase/migrations/0000_*.sql`.
 *
 * Declared with `unique()`, drizzle emits it INSIDE the `CREATE TABLE`, so it exists before any phase
 * that could reference it and the ordering stops being something a generator has to get right. Postgres
 * backs a unique constraint with a unique index of the same name, so nothing is lost on the read side —
 * `store verify` finds the same catalog entry either way. `uq_content_source_native` stays a
 * `uniqueIndex` because nothing references it.
 *
 * ## The thread edge, and why it is TWO columns rather than one
 *
 * A query must be able to follow a reply to its parent. `parent_id` is the relation that does it
 * — a self-referential foreign key, indexed, walked by `store query --thread`. `parent_source_id`
 * beside it is the parent's own `(source, source_id)` half, and it is not redundant: MEASURED,
 * 36,121 of 796,261 edges name a parent outside the ingested window, and with only a uuid stored
 * those rows would be indistinguishable from rows that genuinely start a thread. Keeping the key is what
 * makes them re-resolvable the moment their parent lands.
 *
 * The rules that derive the key are `../project.ts`'s `parentSourceId`, and the pass that turns one into
 * the other is `../resolveEdges.ts`; `docs/store/thread-relations-and-detective-reads.md` § "The thread edge is a RELATION" carries the
 * per-source measurement and why the derivation is a closed marker list rather than a colon split.
 *
 * ## Why full-text search is a column here rather than an index we maintain
 *
 * Same turn: _"you're saying that for free we get full text search in Postgres. I love free stuff … And
 * you're right, it's not a third place."_ `searchable` is a STORED generated column, so it cannot drift
 * from the text it summarises — there is no rebuild step that can be skipped and no second artefact that
 * can go stale, which is the whole failure of the hand-built index this replaces.
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { containerTable } from "./container.js";
import { contentKindEnum, contentSourceEnum, dataClassEnum, visibilityEnum } from "./enums.js";
import { personTable } from "./person.js";
import { storeTablePolicies } from "./rls.js";
import { tsvector } from "./tsvector.js";

/**
 * Every record the world model holds, whatever produced it.
 *
 * `searchable` is generated and stored rather than written, so it is always exactly the text beside it.
 * `visibility` is the axis every row-level security policy turns on — the `bot` role is denied `private`
 * at the policy level rather than by a filter a caller has to remember.
 */
export const contentTable = pgTable(
  "content",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: contentSourceEnum("source").notNull(),
    sourceId: text("source_id").notNull(),
    kind: contentKindEnum("kind").notNull(),
    url: text("url").notNull(),
    occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }).notNull(),
    containerId: uuid("container_id").references(() => containerTable.id, { onDelete: "restrict" }),
    authorId: uuid("author_id").references(() => personTable.id, { onDelete: "restrict" }),
    // What the PLATFORM said authored this row — a Slack member or bot id, a Linear user id, a GitHub login,
    // an address — set whenever the record names an author, whether or not a person resolves. `authorId` is
    // the human that id resolved to through `person`'s id columns and stays null for a bot or a stranger;
    // this column is why that null loses nothing. A bot is never a person.
    authorNativeId: text("author_native_id"),
    // Whether that author is an automation — the source-neutral flag the detective verbs filter on, so a
    // search starts human-only and widens. One rule fills it, {@link ../botAuthor.authorIsBot},
    // from the projection and from `store bots`'s backfill alike. Deliberately UNINDEXED: every filter on it
    // runs after a trigram or tsvector narrowing has already picked the rows, so a btree over two values
    // would serve nothing, and leaving the column out of every index keeps the backfill's UPDATE HOT-eligible.
    authorIsBot: boolean("author_is_bot").default(false).notNull(),
    title: text("title"),
    body: text("body").notNull(),
    visibility: visibilityEnum("visibility").default("public").notNull(),
    // The row's data class (`../dataClass.ts`): nullable with no default, so a row written before classification
    // existed holds none and reads as `unknown`, which fails closed. Never backfilled by the migration adding it.
    dataClass: dataClassEnum("data_class"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    // The parent's own `(source, source_id)` half — the thread edge as a COLUMN rather than a convention
    // a reader has to know. Written by the projection, so it is derived once and never re-derived in SQL;
    // see {@link ../project.parentSourceId} for the four rules and what each one measured.
    parentSourceId: text("parent_source_id"),
    // The edge as a RELATION. Nullable and resolved by a PASS rather than at insert, which is forced
    // rather than chosen: writes are 500-row batches in bronze capture order, so a reply and its parent
    // land in one statement in either order and an insert-time check would reject the batch. It is also
    // why 36,121 of the 796,261 edges measured are null and stay re-resolvable — `parentSourceId`
    // beside it is what tells "has no parent" apart from "the parent is outside the ingested window".
    parentId: uuid("parent_id").references((): AnyPgColumn => contentTable.id, { onDelete: "cascade" }),
    searchable: tsvector("searchable").generatedAlwaysAs(
      (): ReturnType<typeof sql> => sql`to_tsvector('english', coalesce(title, '') || ' ' || body)`,
    ),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One row per (source, native id): re-ingesting the same message updates rather than duplicates.
    uniqueIndex("uq_content_source_native").on(table.source, table.sourceId),
    // Referenced by every per-source table's composite foreign key; see this module's header.
    unique("uq_content_id_source").on(table.id, table.source),
    index("idx_content_source_time").on(table.source, table.occurredAt.desc()),
    index("idx_content_container_time").on(table.containerId, table.occurredAt.desc()),
    index("idx_content_author").on(table.authorId),
    index("idx_content_kind").on(table.kind),
    // The thread walk's own index: a recursive descent asks "which rows name this one as parent", which
    // is a seek on this column and nothing else. Its partner is the primary key, which the upward half
    // of the same walk already seeks.
    index("idx_content_parent").on(table.parentId),
    // The RESOLUTION pass's index, and it is partial on purpose. The pass is `set parent_id from the row
    // whose (source, source_id) matches parent_source_id`, over exactly the rows that have an edge and no
    // relation yet — a set that is 796,261 rows the first time and a handful on every ingest after it. A
    // full index on `(source, parent_source_id)` would carry all 1.2M rows to serve a predicate that is
    // true of almost none of them; this one shrinks to the work that is actually outstanding.
    index("idx_content_parent_unresolved")
      .on(table.source, table.parentSourceId)
      .where(sql`parent_id is null and parent_source_id is not null`),
    index("idx_content_search").using("gin", table.searchable),
    // The two trigram indexes the detective's substring ladder runs on. `searchable` above answers "the
    // stemmed word appears"; these answer "these characters appear", which is a different question and the
    // one that reaches a name inside an email address, a `<@U…|handle>` mention or a URL path segment.
    // MEASURED against a couple of million rows: the `alnum` shape for `barten` takes several seconds as
    // its own statement and under a second through the narrowing scan these serve; without either index
    // `body ilike '%nz%'` takes several seconds where the tsvector answers in about 100 ms. Reproduce with `slopweaver store probe --term
    // barten`. They are declared on the two expressions the ladder actually names — narrowing on the
    // CONCATENATION of title and body matches neither and silently falls back to a sequential scan.
    index("idx_content_body_trgm").using("gin", sql`${table.body} gin_trgm_ops`),
    index("idx_content_title_trgm").using("gin", sql`(coalesce(${table.title}, '')) gin_trgm_ops`),
    // The one table with a private lane, so the one table whose bot predicate is not `true`. A private
    // channel, a direct message, the mailbox and the diary are denied to the Slack-facing role by the
    // database, rather than by a filter every future caller has to remember.
    ...storeTablePolicies({ botRead: sql`visibility = 'public'`, table: "content" }),
  ],
);

/** A content row as the database returns it. */
export type ContentRow = typeof contentTable.$inferSelect;

/** A content row as an insert takes it. */
export type NewContentRow = typeof contentTable.$inferInsert;
