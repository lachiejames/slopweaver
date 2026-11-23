/**
 * One typed table per source, holding the columns that source's platform actually gives.
 *
 * ## The rule this implements, and the measurement that decided its shape
 *
 * A content row does not keep its full source payload. The schema aligns with the reality of what a platform
 * gives: a Slack row has a channel column and a Linear row has a team column. The one exception is information
 * that matters and **cannot be represented** in the database, and the measurement below asks whether any exists.
 *
 * MEASURED over 4,000 records of each source's `compact.jsonl` (reproduce with the script shape in
 * `docs/store/fleet-state-and-measurements.md` § "What `raw` was actually carrying"), and the answer is that
 * nothing is unrepresentable, with one qualification worth having:
 *
 * | source | `raw` as a share of record bytes | the largest single key                            |
 * | ------ | -------------------------------- | ------------------------------------------------- |
 * | slack  | 64.7%                            | `blocks` 35.6%, `attachments` 20.9%               |
 * | linear | 57.2%                            | `description` 35.9%, all of it already in `text`  |
 * | github | 51.2%                            | `body` 85.7% of `raw`, all of it already in `text` |
 * | notion | 31.3%                            | `properties` 40.4%                                |
 *
 * GitHub's `body` and Linear's `description`/`body` were verified byte-for-byte CONTAINED in the record's
 * own `text` column — 13,467,470 of 13,467,470 bytes and 6,200,462 of 6,200,462 bytes respectively — so
 * more than half of what `raw` cost was the body column stored a second time. Nothing found is impossible
 * to represent. The one shape that is genuinely open rather than merely wide is Notion's `properties`: a
 * per-database, user-defined property bag whose key set is not knowable from any schema we control. It
 * keeps a `jsonb` column of its own here rather than a column per property, which is a representation
 * rather than an exception.
 *
 * ## Every promoted column stands, and the provider's object stands beside it
 *
 * That measurement is why each table below is columns rather than a bag, and it is unchanged. Dropping
 * the payload is not the only way to get columns, so the provider's object is kept verbatim in a `raw`
 * envelope on each of these four tables,
 * beside the promoted columns and never instead of them — see {@link rawEnvelope} for why that one
 * column is worth 31–65% of record bytes when nothing else here is. The promoted columns are what a
 * reader filters, joins and indexes on; the envelope is what makes promoting the next one a projection
 * over this table rather than a refetch.
 *
 * ## Why a table per source rather than sparse columns on `content`
 *
 * A column that is null for six sources out of seven is a column every reader has to know not to trust,
 * and a `NOT NULL` that cannot be declared is a constraint that has to be remembered. Split out, Slack's
 * `message_ts` is genuinely `NOT NULL` and the generated type says so; `ContentSlackRow` has no field a
 * GitHub reader can reach.
 *
 * ## How the database refuses a cross-source attach
 *
 * {@link ../content.contentTable} carries a unique index on `(id, source)` — redundant against its own
 * primary key, and there so a composite foreign key can point at it. Each table below then keys
 * `(content_id, source)` to that pair and pins `source` with a CHECK, so a `content_slack` row attached
 * to a GitHub content row is refused by Postgres rather than by a reviewer. The other direction — every
 * Slack content row HAS its `content_slack` row — is {@link SOURCE_ROW_PRESENCE_STATEMENTS}, a deferred
 * constraint trigger, because no key can express "a row exists over there" and a caller remembering to
 * write both is exactly the shape that eventually does not.
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { contentTable } from "./content.js";
import { contentSourceEnum } from "./enums.js";
import { botSeesPublicParent, storeTablePolicies } from "./rls.js";

/**
 * The provider's own object, verbatim, beside the promoted columns on every side table.
 *
 * Declared once and called four times for the same reason {@link linkConstraints} is: written out per
 * table the four could drift in nullability or default, and a fifth per-source table would get the
 * envelope only if somebody remembered. Here it cannot be forgotten and cannot disagree with itself.
 *
 * ## Why this column exists, an exception to the no-full-payload rule for exactly one column
 *
 * The full payload is otherwise left out of the store in favour of real columns, and the measurement
 * behind that stands — see this file's header, where `raw` was 31.3% to 64.7% of record bytes and most
 * of that was the body a second time. This one column is the exception, and the reason is the
 * conversation it ends rather than the bytes it costs: nobody should have to keep asking why a field
 * the provider's API returns is not in the store.
 *
 * With the envelope, "why isn't that in there" has one answer every time — it is, and promoting it is a
 * column plus a backfill over this same table, from disk, with no refetch. Without it the answer is
 * either a schema argument or a network round trip, and the conversation happens anyway. So the rule
 * the schema enforces is **never lose a field**, not **never hide one**: promote what a reader filters
 * or joins on, keep the rest here, promote more when a question asks for it.
 *
 * ## Why `NOT NULL DEFAULT '{}'` rather than nullable
 *
 * `CorpusRecord.raw` is OPTIONAL (`src/corpus/types.ts`) — bronze written before raw capture landed has
 * none — so a projected row genuinely can have nothing to put here. Null would express that, and an
 * empty object expresses it just as exactly, because no provider object this store ingests is empty: a
 * Slack message, a GitHub issue, a Linear issue and a Notion page all carry keys. So `raw = '{}'::jsonb`
 * is an unambiguous "bronze had no payload for this row", and every reader is spared a null check for
 * a distinction that does not exist.
 *
 * ## Why no index
 *
 * Nothing queries the envelope by field — retrieval is Postgres full text over `content.searchable`, and
 * every filter a reader writes is a promoted column. A GIN index here would be paid for on every write
 * and read by nothing. Notion's `properties` keeps its own GIN index because that one IS queried by key.
 *
 * ## What it actually costs, measured on a loaded database rather than on record bytes
 *
 * The 31–65% above is `raw`'s share of a bronze RECORD's bytes, which is the wrong denominator for a
 * decision about a database. MEASURED over a proof database loaded from bronze — 23,157 side
 * rows across the four tables, 198 MB total — every envelope together is **36 MB, 18.3% of the whole
 * database**. It is 36.6% to 80.0% of its own side table and a fifth of the store, because `content`
 * carries the body, the generated tsvector and nine indexes and dominates everything beside it, and
 * because a JSON payload TOAST-compresses where a tsvector does not. Reproduce on any loaded store:
 *
 * ```sql
 * select pg_size_pretty(pg_database_size(current_database())),
 *        pg_size_pretty((select sum(pg_column_size(raw)) from content_slack)
 *                     + (select sum(pg_column_size(raw)) from content_github)
 *                     + (select sum(pg_column_size(raw)) from content_linear)
 *                     + (select sum(pg_column_size(raw)) from content_notion));
 * ```
 *
 * The same load is the witness that the envelope is populated rather than defaulted: Slack, Linear and
 * Notion carry a payload on 100% of rows, GitHub on 2,169 of 2,240 — the 71 without are all `release`
 * records, the one GitHub kind bronze captures with no payload at all.
 *
 * @returns the `raw` column, to spread into a side table's column object
 */
function rawEnvelope() {
  return jsonb("raw").$type<Record<string, unknown>>().default({}).notNull();
}

/**
 * The composite foreign key, the pinning CHECK, and the three row-level-security policies.
 *
 * The policies live here rather than at each of the four call sites because all four are identical: a
 * side row carries no `visibility` column of its own, so the bot's predicate on every one of them is
 * {@link botSeesPublicParent} — the row is visible when the `content` row it hangs off is. The key that
 * ties them does not carry that lane across on its own, which is why the predicate is spelled here and
 * not assumed (`rls.ts` has the measurement). Written out four times they could drift; derived from the
 * table name they cannot, and a fifth per-source table gets them by construction rather than by somebody
 * remembering.
 *
 * @param table the per-source table's own columns
 * @param source the source this table is pinned to
 * @param name the table's name, used to name its constraints and policies deterministically
 * @returns the composite foreign key, the pinning CHECK and the policies, to spread into the extras array
 */
function linkConstraints({
  table,
  source,
  name,
}: {
  table: { contentId: AnyPgColumn; source: AnyPgColumn };
  source: string;
  name: string;
}) {
  return [
    foreignKey({
      columns: [table.contentId, table.source],
      foreignColumns: [contentTable.id, contentTable.source],
      name: `fk_${name}_content`,
    }).onDelete("cascade"),
    check(`${name}_is_${source}`, sql.raw(`source = '${source}'`)),
    ...storeTablePolicies({ botRead: botSeesPublicParent(), table: name }),
  ];
}

/**
 * Slack's own coordinates for a message, and the counts a reader asks about without opening the row.
 *
 * `messageTs` is `NOT NULL` because it is Slack's identity for the message and every permalink, reply and
 * reaction is addressed by it; a Slack row without one cannot be pointed at.
 */
export const contentSlackTable = pgTable(
  "content_slack",
  {
    contentId: uuid("content_id").primaryKey(),
    source: contentSourceEnum("source").notNull().default("slack"),
    channelId: text("channel_id").notNull(),
    channelName: text("channel_name"),
    messageTs: text("message_ts").notNull(),
    threadTs: text("thread_ts"),
    subtype: text("subtype"),
    botId: text("bot_id"),
    appId: text("app_id"),
    replyCount: integer("reply_count").default(0).notNull(),
    reactionCount: integer("reaction_count").default(0).notNull(),
    fileCount: integer("file_count").default(0).notNull(),
    isBot: boolean("is_bot").default(false).notNull(),
    raw: rawEnvelope(),
  },
  (table) => [
    ...linkConstraints({ name: "content_slack", source: "slack", table }),
    index("idx_slack_channel").on(table.channelId),
    index("idx_slack_thread").on(table.threadTs),
    index("idx_slack_bot").on(table.isBot),
  ],
);

/** GitHub's issue and pull-request coordinates, and the review state a reader filters on. */
export const contentGithubTable = pgTable(
  "content_github",
  {
    contentId: uuid("content_id").primaryKey(),
    source: contentSourceEnum("source").notNull().default("github"),
    repo: text("repo").notNull(),
    number: integer("number"),
    state: text("state"),
    isDraft: boolean("is_draft"),
    reviewDecision: text("review_decision"),
    authorAssociation: text("author_association"),
    closedAt: timestamp("closed_at", { mode: "date", withTimezone: true }),
    labels: text("labels").array().default([]).notNull(),
    assignees: text("assignees").array().default([]).notNull(),
    raw: rawEnvelope(),
  },
  (table) => [
    ...linkConstraints({ name: "content_github", source: "github", table }),
    index("idx_github_repo_number").on(table.repo, table.number),
    index("idx_github_state").on(table.state),
    index("idx_github_labels").using("gin", table.labels),
  ],
);

/** Linear's team, workflow state and planning fields, which are what every Linear question filters on. */
export const contentLinearTable = pgTable(
  "content_linear",
  {
    contentId: uuid("content_id").primaryKey(),
    source: contentSourceEnum("source").notNull().default("linear"),
    team: text("team").notNull(),
    identifier: text("identifier"),
    number: integer("number"),
    state: text("state"),
    stateType: text("state_type"),
    priority: integer("priority"),
    priorityLabel: text("priority_label"),
    assignee: text("assignee"),
    project: text("project"),
    cycle: text("cycle"),
    estimate: integer("estimate"),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
    labels: text("labels").array().default([]).notNull(),
    raw: rawEnvelope(),
  },
  (table) => [
    ...linkConstraints({ name: "content_linear", source: "linear", table }),
    index("idx_linear_team_state").on(table.team, table.stateType),
    index("idx_linear_identifier").on(table.identifier),
    index("idx_linear_assignee").on(table.assignee),
    index("idx_linear_labels").using("gin", table.labels),
  ],
);

/**
 * Notion's page hierarchy and its property bag.
 *
 * `properties` is the one column on any of these four tables that is deliberately open. Notion's
 * properties are defined per DATABASE by whoever made it, so their key set is not knowable from a schema
 * we control — it is the single thing measured in this store's bronze that a fixed column list cannot
 * express, and it is 40.4% of what Notion's `raw` cost.
 */
export const contentNotionTable = pgTable(
  "content_notion",
  {
    contentId: uuid("content_id").primaryKey(),
    source: contentSourceEnum("source").notNull().default("notion"),
    parentKind: text("parent_kind"),
    parentId: text("parent_id"),
    icon: text("icon"),
    isArchived: boolean("is_archived").default(false).notNull(),
    lastEditedAt: timestamp("last_edited_at", { mode: "date", withTimezone: true }),
    chunkIndex: integer("chunk_index"),
    chunkCount: integer("chunk_count"),
    properties: jsonb("properties").$type<Record<string, unknown>>().default({}).notNull(),
    raw: rawEnvelope(),
  },
  (table) => [
    ...linkConstraints({ name: "content_notion", source: "notion", table }),
    index("idx_notion_parent").on(table.parentKind, table.parentId),
    index("idx_notion_properties").using("gin", table.properties),
  ],
);

/** Every per-source table, keyed by the source it is pinned to. */
export const SOURCE_ROW_TABLES = {
  github: contentGithubTable,
  linear: contentLinearTable,
  notion: contentNotionTable,
  slack: contentSlackTable,
} as const;

/** The sources that have a per-source table of their own. */
export const SOURCES_WITH_ROW_TABLE = ["github", "linear", "notion", "slack"] as const;

/** A source that carries a per-source table. */
export type SourceWithRowTable = (typeof SOURCES_WITH_ROW_TABLE)[number];

/**
 * Whether this source has a per-source table, so a caller narrows rather than casts.
 *
 * @returns whether the store holds a typed side row for that source
 */
export function hasSourceRowTable(value: string): value is SourceWithRowTable {
  return (SOURCES_WITH_ROW_TABLE as readonly string[]).includes(value);
}

/**
 * The deferred constraint trigger enforcing the direction a foreign key cannot: every content row of a
 * source that has a table HAS its row in that table.
 *
 * DEFERRABLE INITIALLY DEFERRED rather than immediate, and that is the whole reason this works: the
 * content row and its side row are written by two statements, so an immediate check would refuse the
 * first one every time. Deferred, it fires at COMMIT, by which point a correct transaction has written
 * both and an incorrect one has not — which is exactly the property wanted. Ingest therefore writes each
 * batch inside a transaction; outside one, each statement is its own transaction and a bare content
 * insert is refused on the spot, which is also correct.
 *
 * MEASURED against the local Supabase stack on Postgres 17: a `content` insert of a Slack row
 * with no `content_slack` row raises `slack content row … has no content_slack row`; the same insert
 * followed by its side row inside one transaction commits; a `content_slack` row pointed at a GitHub
 * content row is refused earlier still, by the composite foreign key.
 *
 * @returns the statements a migration runs, in order, to install the constraint
 */
export const SOURCE_ROW_PRESENCE_STATEMENTS: readonly string[] = [
  `create or replace function content_source_row_present() returns trigger language plpgsql as $$
      declare present boolean;
      begin
        if new.source::text not in ('github','linear','notion','slack') then
          return new;
        end if;
        execute format('select exists (select 1 from %I where content_id = $1)', 'content_' || new.source::text)
          into present using new.id;
        if not present then
          raise exception '% content row % has no content_% row', new.source, new.id, new.source;
        end if;
        return new;
      end $$`,
  `drop trigger if exists trg_content_source_row_present on content`,
  `create constraint trigger trg_content_source_row_present
       after insert or update on content
       deferrable initially deferred
       for each row execute function content_source_row_present()`,
];

/** The trigger the presence constraint installs, named so a migration can drop it deterministically. */
export const SOURCE_ROW_PRESENCE_TRIGGER = "trg_content_source_row_present";

/** A Slack side row as the database returns it. */
export type ContentSlackRow = typeof contentSlackTable.$inferSelect;
/** A Slack side row as an insert takes it. */
export type NewContentSlackRow = typeof contentSlackTable.$inferInsert;
/** A GitHub side row as the database returns it. */
export type ContentGithubRow = typeof contentGithubTable.$inferSelect;
/** A GitHub side row as an insert takes it. */
export type NewContentGithubRow = typeof contentGithubTable.$inferInsert;
/** A Linear side row as the database returns it. */
export type ContentLinearRow = typeof contentLinearTable.$inferSelect;
/** A Linear side row as an insert takes it. */
export type NewContentLinearRow = typeof contentLinearTable.$inferInsert;
/** A Notion side row as the database returns it. */
export type ContentNotionRow = typeof contentNotionTable.$inferSelect;
/** A Notion side row as an insert takes it. */
export type NewContentNotionRow = typeof contentNotionTable.$inferInsert;
