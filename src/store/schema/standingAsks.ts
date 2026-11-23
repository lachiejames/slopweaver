/**
 * The owner's standing asks, as the store tables that ARE their authority (`src/profile/standingAsks.ts` is the domain).
 *
 * The old `judgement/standing-asks.jsonl` journal is imported once (`./homeFileImport.ts`, register
 * `standing-asks`) and never answers a read again; its marker records the file's sha256 and size, and every later
 * operation checks the path against them, so a file changed after the import is refused rather than ignored.
 *
 * ## Three tables, one register
 *
 * - `standing_ask_event` is the JOURNAL: one row per event, carrying the exact v1 line an export writes, ordered by
 *   `journal_seq`. An imported line keeps its own text and its nonblank ordinal as its sequence, so an export of
 *   the store is byte-identical to an export of the file it came from.
 * - `standing_ask` is one row per recorded GENERATION of an ask, its state the journal's fold: `active`, or
 *   `withdrawn` once withdrawn. `inactive` is a restored ask `store import --apply` stores without letting it stand
 *   behind a card: it answers an import question, records no journal event and so carries no `recorded_seq`, and
 *   every other generation carries one.
 * - `standing_ask_coverage` is one row per card kind a generation covers, carrying its parent's state through a
 *   composite foreign key that cascades, so the partial unique index on active coverage is the database's own
 *   guarantee that one card never has two standing asks to quote.
 *
 * Instants stay text: an ask's `recordedAtIso` and its quote's `atIso` are what the journal line spells, and a
 * reader compares the projection with the fold of those lines exactly, which a timestamp column would respell.
 *
 * The bot is denied all three, as it is every judgement table.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { storeImportQuestionTable } from "./importStaging.js";
import { storeTablePolicies } from "./rls.js";

/** Whether one generation of a standing ask stands behind a card. */
export const standingAskStateEnum = pgEnum("standing_ask_state", ["active", "inactive", "withdrawn"]);

/**
 * Which writer produced a generation or an event: the one-time import of the home file, `profile standing`, or an
 * applied store import (`store import --apply`).
 */
export const standingAskOriginEnum = pgEnum("standing_ask_origin", ["legacy-file", "profile", "store-import"]);

/** The id grammar `STANDING_ASK_ID` holds an ask to. */
const ASK_ID = sql`'^[a-z0-9]+(-[a-z0-9]+)*$'`;

/** One recorded generation of one standing ask. */
export const standingAskTable = pgTable(
  "standing_ask",
  {
    rowId: uuid("row_id").primaryKey().defaultRandom(),
    /** The ask's id, which a later generation may reuse once this one is withdrawn. */
    askId: text("ask_id").notNull(),
    state: standingAskStateEnum("state").notNull(),
    origin: standingAskOriginEnum("origin").notNull(),
    quoteAnchor: text("quote_anchor").notNull(),
    quoteAt: text("quote_at").notNull(),
    quoteCut: text("quote_cut").$type<"none" | "start" | "end">().notNull(),
    quoteWhere: text("quote_where")
      .$type<"console-typed" | "console-voice" | "call" | "call-landing" | "session">()
      .notNull(),
    quoteWords: text("quote_words").notNull(),
    recordedAt: text("recorded_at").notNull(),
    /**
     * The `journal_seq` of the event that recorded it, which orders the active asks; null only on an inactive imported
     * generation, which no event recorded.
     */
    recordedSeq: bigint("recorded_seq", { mode: "number" }).unique("uq_standing_ask_recorded_seq"),
    /** The import question this generation answered, when an applied import landed it. */
    importQuestionId: text("import_question_id")
      .unique("uq_standing_ask_import_question")
      .references(() => storeImportQuestionTable.id),
  },
  (table) => [
    unique("uq_standing_ask_row_state").on(table.rowId, table.state),
    uniqueIndex("uq_standing_ask_active")
      .on(table.askId)
      .where(sql`state = 'active'`),
    check("standing_ask_id", sql`ask_id ~ ${ASK_ID}`),
    check("standing_ask_quote", sql`quote_anchor <> '' and quote_at <> '' and quote_words <> ''`),
    check("standing_ask_quote_cut", sql`quote_cut in ('none', 'start', 'end')`),
    check(
      "standing_ask_quote_where",
      sql`quote_where in ('console-typed', 'console-voice', 'call', 'call-landing', 'session')`,
    ),
    check("standing_ask_recorded_at", sql`recorded_at <> ''`),
    check(
      "standing_ask_recorded_seq",
      sql`(state = 'inactive' and origin = 'store-import' and import_question_id is not null and recorded_seq is null) or (state <> 'inactive' and recorded_seq is not null and recorded_seq > 0)`,
    ),
    check("standing_ask_import_origin", sql`(origin = 'store-import') = (import_question_id is not null)`),
    ...storeTablePolicies({ botRead: sql`false`, table: "standing_ask" }),
  ],
);

/** One card kind one generation covers, carrying the generation's state. */
export const standingAskCoverageTable = pgTable(
  "standing_ask_coverage",
  {
    askRowId: uuid("ask_row_id").notNull(),
    /** Where it sits in the ask's own `covers` list. */
    ordinal: integer("ordinal").notNull(),
    coverage: text("coverage").notNull(),
    /** The parent's state, kept equal by the cascading foreign key, so the active-coverage index can see it. */
    state: standingAskStateEnum("state").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.askRowId, table.coverage], name: "pk_standing_ask_coverage" }),
    unique("uq_standing_ask_coverage_ordinal").on(table.askRowId, table.ordinal),
    foreignKey({
      columns: [table.askRowId, table.state],
      foreignColumns: [standingAskTable.rowId, standingAskTable.state],
      name: "fk_standing_ask_coverage_ask",
    })
      .onUpdate("cascade")
      .onDelete("restrict"),
    uniqueIndex("uq_standing_ask_coverage_active")
      .on(table.coverage)
      .where(sql`state = 'active'`),
    check("standing_ask_coverage_ordinal", sql`ordinal >= 0`),
    check(
      "standing_ask_coverage_kind",
      sql`coverage in ('findings', 'registered-rows', 'bot-replies', 'unlinked-cards') or coverage ~ '^act:[a-z0-9]+([-.][a-z0-9]+)*$'`,
    ),
    ...storeTablePolicies({ botRead: sql`false`, table: "standing_ask_coverage" }),
  ],
);

/** One journal event, as the exact line an export writes. */
export const standingAskEventTable = pgTable(
  "standing_ask_event",
  {
    eventId: uuid("event_id").primaryKey().defaultRandom(),
    journalSeq: bigint("journal_seq", { mode: "number" }).notNull().unique("uq_standing_ask_event_seq"),
    askRowId: uuid("ask_row_id")
      .notNull()
      .references(() => standingAskTable.rowId),
    kind: text("kind").$type<"recorded" | "withdrawn">().notNull(),
    origin: standingAskOriginEnum("origin").notNull(),
    /** The portable v1 journal line, exactly as the file held it or `standingAskLine` wrote it. */
    exactLine: text("exact_line").notNull(),
    storedAt: timestamp("stored_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("standing_ask_event_seq", sql`journal_seq > 0`),
    check("standing_ask_event_kind", sql`kind in ('recorded', 'withdrawn')`),
    check("standing_ask_event_line", sql`exact_line <> ''`),
    ...storeTablePolicies({ botRead: sql`false`, table: "standing_ask_event" }),
  ],
);
