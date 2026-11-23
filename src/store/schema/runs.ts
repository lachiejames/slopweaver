/**
 * What HAPPENED — the run journals that survive compaction and session death, and the Codex passes.
 *
 * Two tables and a child, from two directories in the home: `runs/<slug>.jsonl` becomes {@link runTable}
 * plus {@link runEventTable}, and `orchestration/<id>/record.json` becomes {@link codexPassTable}.
 *
 * ## Why a run is two tables and a board row is one
 *
 * A board row is a DOCUMENT — one frontmatter, one row, re-projected whole when the file changes. A run
 * journal is an EVENT LOG, and `../../handover/ledger.ts`'s `runStateOf` derives the run's phase, branch,
 * writer and doc hash by folding every line of it. Flattening that fold into one row would store a
 * derivation and throw away what it was derived from — and the fold is not stable, because a new event
 * kind changes what a journal MEANS about a run that was written months ago. So the events are stored and
 * {@link runTable} carries only what identifies the run and what the fold currently says, marked as
 * derived by `derivedAt`. A reader who distrusts the summary replays the events.
 *
 * ## The 16 GB that does NOT land, stated because it is the point
 *
 * `orchestration/` is 875,337 files and 16 GB, of which 692,581 are `.ts`, `.js` or `.map` — every one a
 * copy of code already in git, inside a `.scratch` sibling holding a full `node_modules`. MEASURED;
 * reproduce with `du -sh ~/.slopweaver/orchestration` and
 * `find ~/.slopweaver/orchestration -name '*.scratch' -maxdepth 1 | wc -l`. The durable part of a Codex
 * pass is its `record.json` and its `artifact.md`, which is what {@link codexPassTable} holds. The rest is
 * the `scratch` tier of the three-tier rule — reproducible or dead, never a table.
 */
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { RunPhase } from "../../handover/ledger.js";

import { storeTablePolicies } from "./rls.js";
import { tsvector } from "./tsvector.js";

/**
 * Every phase a run can be in, as the tuple `pgEnum` requires.
 *
 * See `./board.ts`'s `STATUS_VALUES` for why these are spelled rather than derived, and
 * `src/__tests__/unit/store/schemaDrift.test.ts` for the test that catches a missing member.
 */
const PHASE_VALUES = ["open", "waiting-on-owner", "closed"] as const satisfies readonly RunPhase[];

/**
 * Where a run has got to, as its own journal currently folds.
 *
 * `waiting-on-owner` is deliberately distinct from `open` — the gates refuse an `open` run that tries to
 * end and allow a `waiting-on-owner` one, because the question has been written down (AGENTS.md rule 6).
 */
export const runPhaseEnum = pgEnum("run_phase", PHASE_VALUES);

/**
 * One run, keyed by the slug of the board row it executes.
 *
 * `slug` is NOT a foreign key onto `board_row`. A journal outlives its document — `handover reap` and the
 * board's own CONTRADICTION report both exist because a run whose doc was deleted or renamed is a real,
 * frequent state that the board REPORTS rather than refuses. A constraint here would make the import fail
 * on exactly the rows a reader most wants to see.
 */
export const runTable = pgTable(
  "run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    /** What `runStateOf` folds the journal to — a DERIVATION, which is why `derivedAt` sits beside it. */
    phase: runPhaseEnum("phase").notNull(),
    /** The branch recorded at `handover start`, so "in flight" is an exact fact rather than a name guess. */
    branch: text("branch"),
    /** The session that holds the journal's write lock, when the fold names one. */
    writerSession: text("writer_session"),
    /** The doc's content hash as of the latest `started` or `amended` event. */
    docHash: text("doc_hash"),
    firstEventAt: timestamp("first_event_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    lastEventAt: timestamp("last_event_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    eventCount: integer("event_count").notNull(),
    /** When the fold above was computed. A run re-imported later re-folds and this moves. */
    derivedAt: timestamp("derived_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
    sourcePath: text("source_path").notNull(),
  },
  (table) => [
    uniqueIndex("uq_run_slug").on(table.slug),
    index("idx_run_phase_last").on(table.phase, table.lastEventAt.desc()),
    // "which runs is this session the writer of" — the liveness question, as a seek.
    index("idx_run_writer").on(table.writerSession),
    // A journal quotes a question the owner was asked and an answer the owner gave; denied to the bot outright, the
    // same conservative port `./memories.ts` and `./board.ts` take.
    ...storeTablePolicies({ botRead: sql`false`, table: "run" }),
  ],
);

/**
 * One line of one run journal, stored whole.
 *
 * `kind` is `text` and NOT an enum, and that is the one deliberate departure from `./enums.ts`'s rule.
 * `RunEvent` has twenty-one members today and gains one whenever a new ending is typed — and a journal is
 * append-only HISTORY, so a kind that was written in August must remain importable after the union stops
 * naming it. An enum makes that import fail; `text` makes it a row a reader can see. The vocabulary is
 * still checked, upstream, by the decoder that wrote the line.
 *
 * `payload` carries the event's own per-kind fields verbatim. They are per-kind by construction — a
 * `probed` has counts, a `question` has prose — so there is no column set that fits them and no query that
 * filters across them; `searchable` is what makes the prose ones findable.
 */
export const runEventTable = pgTable(
  "run_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runTable.id, { onDelete: "cascade" }),
    /** The 1-based physical line in the journal — the tie-break between two events at one instant. */
    lineNumber: integer("line_number").notNull(),
    kind: text("kind").notNull(),
    atIso: timestamp("at_iso", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<Readonly<Record<string, unknown>>>().notNull(),
    searchable: tsvector("searchable").generatedAlwaysAs(
      (): ReturnType<typeof sql> => sql`to_tsvector('english', kind || ' ' || coalesce(payload::text, ''))`,
    ),
  },
  (table) => [
    // A second import of the same journal replaces rather than duplicates: one line is one event.
    uniqueIndex("uq_run_event_line").on(table.runId, table.lineNumber),
    index("idx_run_event_run_time").on(table.runId, table.atIso),
    // "every question any run recorded" and "every ruling the owner gave" are both this shape.
    index("idx_run_event_kind_time").on(table.kind, table.atIso.desc()),
    index("idx_run_event_search").using("gin", table.searchable),
    ...storeTablePolicies({ botRead: sql`false`, table: "run_event" }),
  ],
);

/**
 * One Codex pass — what it was asked to attack, what it concluded, and the artifact it wrote.
 *
 * `artifact` is the pass's `artifact.md`, inline as text rather than a Storage blob: MEASURED:
 * the whole set is a few MB across 3,378 passes, which is a text column, not an object store. The
 * `.scratch` sibling beside each is what the header says never lands.
 *
 * `property` is the exact statement the pass was told to falsify. It is the single most useful column
 * here — "has anything ever attacked this seam" is a question the fleet asks constantly and currently
 * answers by grepping 16 GB.
 */
export const codexPassTable = pgTable(
  "codex_pass",
  {
    /** The pass's own artifact id — its directory name, and a uuid, so it IS the primary key. */
    id: uuid("id").primaryKey(),
    /** `p1`…`p3` or `r1`…`r3`. Text, not an enum: the ladder's width is a policy that has moved before. */
    pass: text("pass"),
    /** `plan` or `review`. Text, for the same reason as `pass`. */
    mode: text("mode"),
    propertyId: text("property_id"),
    property: text("property"),
    /** How the pass ENDED, as `record.json`'s own outcome discriminator — `conclusive`, `fatal`, `spent`. */
    outcome: text("outcome").notNull(),
    model: text("model"),
    branch: text("branch"),
    headSha: text("head_sha"),
    baseSha: text("base_sha"),
    diffSha256: text("diff_sha256"),
    repoRoot: text("repo_root"),
    elapsedMs: integer("elapsed_ms"),
    createdAt: timestamp("created_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    /** The pass's `artifact.md`, whole. NULL when the pass died before writing one, which is common. */
    artifact: text("artifact"),
    /** `record.json` verbatim, so a column this table does not have is still recoverable from the row. */
    record: jsonb("record").$type<Readonly<Record<string, unknown>>>().notNull(),
    searchable: tsvector("searchable").generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`to_tsvector('english', coalesce(property, '') || ' ' || coalesce(artifact, ''))`,
    ),
  },
  (table) => [
    index("idx_codex_pass_search").using("gin", table.searchable),
    // "every pass on this branch", which is what `codex status --check` asks on every landing.
    index("idx_codex_pass_branch_time").on(table.branch, table.createdAt.desc()),
    index("idx_codex_pass_outcome_time").on(table.outcome, table.createdAt.desc()),
    ...storeTablePolicies({ botRead: sql`false`, table: "codex_pass" }),
  ],
);

/** A run as the database returns it. */
export type RunRecord = typeof runTable.$inferSelect;

/** A run as an insert takes it. */
export type NewRunRecord = typeof runTable.$inferInsert;

/** One journal line as the database returns it. */
export type RunEventRecord = typeof runEventTable.$inferSelect;

/** One journal line as an insert takes it. */
export type NewRunEventRecord = typeof runEventTable.$inferInsert;

/** A Codex pass as the database returns it. */
export type CodexPassRecord = typeof codexPassTable.$inferSelect;

/** A Codex pass as an insert takes it. */
export type NewCodexPassRecord = typeof codexPassTable.$inferInsert;
