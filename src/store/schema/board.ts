/**
 * The board, as rows — every `$SLOPWEAVER_HOME/handovers/*.md` frontmatter, in the store.
 *
 * Everything is taken out of the user-level Slopweaver directory and put into the store, which is where all
 * the data sits and which makes it more portable. The board is the largest record-shaped thing that was still only a directory of files.
 *
 * ## The files stay authoritative, and that is the whole import contract
 *
 * Nothing here replaces `../../handover/store.ts`. A board row is written by `handover register`, read by
 * `handover list`, and survives session death precisely because it is a file — the property AGENTS.md's
 * "resume before anything else" section depends on. This table is a PROJECTION of those files, refreshed
 * by `slopweaver store import-fleet`, so a query can ask "every p1 ask the owner made that is still open" in one
 * index seek instead of parsing 2,096 YAML headers. The schema-review page's step 9 states the same
 * sequencing: _"the files stay as the source until each cutover is proven; keep them"_.
 *
 * So `sourcePath` and `docHash` are not decoration. They are what makes a row re-derivable: a re-import
 * over an edited file replaces the row rather than adding one, and a row whose hash no longer matches its
 * file is a row the projection has not caught up with — a question a reader can ASK, rather than a drift
 * nobody can see.
 *
 * ## Why the vocabularies are enums and the probes are not
 *
 * `status`, `kind`, `priority`, `settlement` and `origin` are closed unions in
 * `../../handover/rowKind.ts` and `../../handover/doc.ts`, so they are enums here for the reason
 * `./enums.ts` gives at length — a board row once carried a `status:` outside the type and was invalid on
 * Saturday and valid on Sunday with nothing about it changing. `doneWhen:` probes are the opposite shape:
 * a discriminated union with per-kind fields, a handful per row, never filtered on. They ride as `jsonb`,
 * which is where the archive put its own open shapes and where `content.metadata` puts this store's.
 */
import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { DocStatus } from "../../handover/doc.js";
import type { Probe } from "../../handover/probe.js";
import type { AskSettlement, BoardPriority, BoardRowKind, RowOrigin } from "../../handover/rowKind.js";

import { storeTablePolicies } from "./rls.js";
import { tsvector } from "./tsvector.js";

/**
 * Every status a doc may declare, as the tuple `pgEnum` requires.
 *
 * Spelled here rather than derived from the union, for the reason `./memories.ts`'s `VERDICT_VALUES`
 * records: a `readonly [string, ...string[]]` tuple in `../../handover/doc.ts` would be read by the
 * `named-object-params` gate's whole-repo program, and that gate recurses without bound on tuple
 * receivers. `satisfies` keeps a typo from compiling and
 * `src/__tests__/unit/store/schemaDrift.test.ts` keeps a MISSING member from shipping.
 */
const STATUS_VALUES = [
  "draft",
  "ready",
  "in-progress",
  "paused",
  "done",
  "cancelled",
  "rejected",
  "unknown",
] as const satisfies readonly DocStatus[];

/** Every row kind, as a tuple. See {@link STATUS_VALUES}. */
const KIND_VALUES = ["doc", "ask", "tag"] as const satisfies readonly BoardRowKind[];

/** Every priority band, as a tuple. See {@link STATUS_VALUES}. */
const PRIORITY_VALUES = ["p0", "p1", "p2", "p3"] as const satisfies readonly BoardPriority[];

/** Every terminal state an ask may settle into, as a tuple. See {@link STATUS_VALUES}. */
const SETTLEMENT_VALUES = ["filed", "answered", "declined"] as const satisfies readonly AskSettlement[];

/** Every origin a row may declare, as a tuple. See {@link STATUS_VALUES}. */
const ORIGIN_VALUES = ["finding"] as const satisfies readonly RowOrigin[];

/** What state the doc's author declared the work to be in. */
export const boardStatusEnum = pgEnum("board_status", STATUS_VALUES);

/** What the row IS — planned work, something the owner asked for, or an unanswered tag. */
export const boardKindEnum = pgEnum("board_kind", KIND_VALUES);

/** The band a row ranks in, when its author named one. */
export const boardPriorityEnum = pgEnum("board_priority", PRIORITY_VALUES);

/** How an ask ENDED. Distinct from {@link boardStatusEnum}: an ask declined in one line shipped nothing. */
export const boardSettlementEnum = pgEnum("board_settlement", SETTLEMENT_VALUES);

/** Where a row came from — present only when a SESSION registered it rather than the owner. */
export const boardOriginEnum = pgEnum("board_origin", ORIGIN_VALUES);

/**
 * One board row, projected from one handover document.
 *
 * `slug` is the natural key and it is UNIQUE, because that is what the board's own `blockedBy:` edges
 * reference and what `handover resume` resolves. A surrogate `id` sits beside it so a future edge table
 * has something stable to point at while a slug is still free to be renamed with its file.
 *
 * `searchable` covers the slug and the summary, which is what a reader actually types — "the row about
 * the merge queue" — and is generated and STORED so it cannot drift from the text beside it.
 */
export const boardRowTable = pgTable(
  "board_row",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    kind: boardKindEnum("kind").notNull(),
    status: boardStatusEnum("status").notNull(),
    priority: boardPriorityEnum("priority"),
    summary: text("summary"),
    /** `repo:` — the checkout this row's probes and branch resolve against. */
    repo: text("repo"),
    /** `branch:` — the exact branch, never a name guess; the finding gate matches on it. */
    branch: text("branch"),
    baseBranch: text("base_branch"),
    /** `askedIso:` — when the owner said it. The field the ask-latency number is computed from. */
    askedAt: timestamp("asked_at", { mode: "date", precision: 3, withTimezone: true }),
    /** `anchor:` — where the owner said it. Attributable, never authenticated. */
    anchor: text("anchor"),
    settlement: boardSettlementEnum("settlement"),
    settlementWitness: text("settlement_witness"),
    settlementReason: text("settlement_reason"),
    origin: boardOriginEnum("origin"),
    observedBy: text("observed_by"),
    ruling: text("ruling"),
    rulingAnchor: text("ruling_anchor"),
    pausedOn: text("paused_on"),
    pausedSince: timestamp("paused_since", { mode: "date", precision: 3, withTimezone: true }),
    /** `blockedBy:` — the slugs this row waits on, as written. Not a foreign key: a row may name a doc
     * that does not exist yet, and the board REPORTS that rather than refusing the row. */
    blockedBy: jsonb("blocked_by").$type<readonly string[]>().notNull().default([]),
    /** `evidence:` — what a finding row was registered FROM. */
    evidence: jsonb("evidence").$type<readonly string[]>().notNull().default([]),
    /** `doneWhen:` — the probes, whole. A discriminated union nobody filters on; see the header. */
    doneWhen: jsonb("done_when").$type<readonly Probe[]>().notNull().default([]),
    outputs: jsonb("outputs").$type<readonly string[]>().notNull().default([]),
    /**
     * The document's PROSE — everything below the front-matter, whole and unparsed.
     *
     * The column that lets the folder go away. Every other column here is a front-matter field, so a store
     * holding all of them still could not answer "what does this row actually say" without reading the file
     * — which means `handovers/` would have to survive, and the aim is to rely on no local files and
     * folders. That restates the rule that data lives in the store, of which the board was the piece
     * sequenced last.
     *
     * `text`, not `jsonb` and not a parsed structure: the body is markdown a session reads and a session
     * wrote, its headings are a convention rather than a schema, and the one operation anything performs on
     * it is "give it back exactly". Parsing it into columns would invent a contract the documents do not
     * have — `searchable` already covers the part a reader queries.
     *
     * Nullable while the import is a PROJECTION: `store import-fleet` back-fills it from the file, so a row
     * imported before this column existed is honestly empty rather than falsely blank. It stops being
     * nullable when the store becomes authoritative and a row is born here.
     */
    body: text("body"),
    /** The absolute path the row was projected from, so a reader can go and read the file itself. */
    sourcePath: text("source_path").notNull(),
    /** The document's content hash at projection time — what makes a stale row visible rather than silent. */
    docHash: text("doc_hash").notNull(),
    importedAt: timestamp("imported_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
    searchable: tsvector("searchable").generatedAlwaysAs(
      (): ReturnType<typeof sql> => sql`to_tsvector('english', slug || ' ' || coalesce(summary, ''))`,
    ),
  },
  (table) => [
    uniqueIndex("uq_board_row_slug").on(table.slug),
    index("idx_board_row_search").using("gin", table.searchable),
    // "what is runnable now" — the board's own first question.
    index("idx_board_row_status_priority").on(table.status, table.priority),
    // "every ask the owner made, newest first" and the ask-latency number both read this.
    index("idx_board_row_kind_asked").on(table.kind, table.askedAt.desc()),
    // "which findings has the owner not ruled on" — the door gate's question, as a query.
    index("idx_board_row_origin_settlement").on(table.origin, table.settlement),
    // A board row's summary can quote a private channel, so the bot is denied outright rather than
    // trusted — the same conservative port `./memories.ts` takes, and for the same reason.
    ...storeTablePolicies({ botRead: sql`false`, table: "board_row" }),
  ],
);

/** A board row as the database returns it. */
export type BoardRowRecord = typeof boardRowTable.$inferSelect;

/** A board row as an insert takes it. */
export type NewBoardRowRecord = typeof boardRowTable.$inferInsert;
