/**
 * What we DID — the door's audit trail, the autonomy ledger, and the journalled grants.
 *
 * Three append-only files in `$SLOPWEAVER_HOME/ledgers` and `$SLOPWEAVER_HOME/grants`, as three tables.
 * Unlike the board and the runs, these are HISTORY rather than state: nothing folds them, nothing
 * re-projects them, and a row once written is never rewritten. So the import key is the physical LINE,
 * exactly as `../../knowledge/importLessons.ts` keys the register it replaced, and for the same reason —
 * a file that has grown since the last apply produces the same keys for the lines already imported and
 * new keys only for the ones appended after them.
 *
 * ## The lie this table is built not to tell
 *
 * `door.jsonl` holds 198,071 rows and **most of them are not real external actions**. The unit-test suite
 * wrote door records into the ambient `$SLOPWEAVER_HOME` on every lap until the sandbox guard
 * (`src/__tests__/setup-ambient-home.ts`) landed. Importing the file
 * as-is would put "this install posted 11,224 Slack messages on one day" into a database people trust.
 *
 * **The separator is NOT the guard commit's instant.** A commit's date is when the guard became AVAILABLE; a
 * worktree on an older commit keeps running the suite against the ambient home until it rebases, and one did
 * for nearly four more hours. Seven minutes after the commit, one second of the ledger holds 37 rows, 20 on a
 * single fixture `duplicateKey`; eight later rows name channel `C1`, a two-character
 * fixture id no real Slack channel has.
 *
 * The separator is therefore DERIVED from the ledger — the last row bearing a proven test marker, which two
 * independent markers agree on. `../fleet/doorEvent.ts` carries both
 * commands and is where the criterion lives. The guard commit remains the EXPLANATION for why the writes
 * stop there rather than somewhere arbitrary.
 *
 * The scale, measured over 198,100 imported rows: 190,926 unattributable against 7,174
 * attributed, and `verb:slack.post` 169,220 against 119. Correcting the criterion re-labelled 209 rows
 * the first version had called real external actions. Across the whole file those 169,339 posts carry only 437 distinct
 * `duplicateKey` values, three of which account for 137,217 rows. A duplicate key is the hash of the
 * message, the target and the identity, so 54,325 posts of one identical message is a fixture replayed,
 * not a send.
 *
 * **Nothing is dropped, and nothing is labelled real that cannot be shown to be.** {@link doorProvenanceEnum}
 * is two values: a row strictly after the separator is `attributed`; every row at it or before it is
 * `unattributable`, because no marker distinguishes a test write from a real one in that era and inventing
 * one would be the fabrication this whole separation exists to prevent. The conservative direction is
 * deliberate — a query answering "what has this install actually done" filters on `attributed` and is
 * never wrong, and a better classifier later re-labels rows that are all still here.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { storeTablePolicies } from "./rls.js";

/**
 * Whether a door row can be shown NOT to have been written by the test suite.
 *
 * Two values, not three, and `unattributable` is not a synonym for "fake": it means exactly what it says.
 * See this module's header for the measurement and the repro.
 */
export const doorProvenanceEnum = pgEnum("door_provenance", ["attributed", "unattributable"]);

/**
 * Every decision the door took — pass, warn, hold, every override that waived a warning, and every send a
 * pre-door gate refused.
 *
 * ## The record, not a mirror
 *
 * This table IS the door's audit trail: `throughDoor` (`../../admit/effects.ts`) inserts here before it performs
 * any effect, and every reader reads here, through `../../admit/doorLedgerPort.ts`.
 * `$SLOPWEAVER_HOME/ledgers/door.jsonl` is only the source of the one-time `store import-fleet --only door`, and
 * {@link doorRegisterTable} records that it ran.
 *
 * `record` is the line verbatim, and it is the authority: the scalar columns are projections of it for the
 * indexes, because a pre-door refusal carries fields no column names (`surface`, `hatch`, `gate`). A row whose
 * `record` is NULL is a projection a mirror import wrote before this table became the ledger; the one-time import
 * fills it in from the same line, and a reader meeting one still NULL refuses rather than skipping it. `seq` is
 * the order every read takes. A live row's `import_key` is `written:<uuid>`, and it is always `attributed`.
 *
 * `findings` stays `jsonb`: each carries a code, a severity and the policy prose a gate authored, and the whole
 * point of the door ledger is that a withheld action records WHY — which is the summary, not a field anybody
 * filters on.
 */
export const doorEventTable = pgTable(
  "door_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Insert order — what the ledger's line order was. Every read orders by it. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    /** `verb:<noun>.<verb>` or `raw-tool:<tool>` — the flattened action label the ledger records. */
    action: text("action").notNull(),
    /** What the action DOES: `external-write`, `external-read`, `local`. Text, mirroring the line. */
    effect: text("effect").notNull(),
    /** `pass`, `warn` or `hold`. */
    status: text("status").notNull(),
    findings: jsonb("findings").$type<readonly Readonly<Record<string, unknown>>[]>().notNull().default([]),
    overridden: jsonb("overridden").$type<readonly string[]>().notNull().default([]),
    /** The door's own run id for the decision. Unique per row in the source; not a key. */
    doorRunId: text("door_run_id"),
    /** The opaque re-send identity, when the artifact carried one. The duplicate-send gate reads it. */
    duplicateKey: text("duplicate_key"),
    /**
     * Every waiver an `--acknowledge` carried, verbatim, when the request carried any.
     *
     * A LIST because one invocation waives more than one subject — `github enqueue`'s `--acknowledge` is a
     * comma-separated set, and a fleet pull request routinely waives `codex-loop-incomplete` and
     * `ci-rollup-superseded` together. `../fleet/doorEvent.ts` normalises both the current
     * `acknowledgements` key and the historical singular `acknowledgement` one into this shape, so the 243
     * lines that predate the list (measured on `~/.slopweaver/ledgers/door.jsonl`, with
     * `grep -c '"acknowledgement"' ~/.slopweaver/ledgers/door.jsonl` against 201,300 lines) keep landing
     * here rather than becoming `null`. The COLUMN keeps its singular name: renaming it buys nothing a
     * reader needs and costs a migration over a table the atlas already loads.
     */
    acknowledgement: jsonb("acknowledgement").$type<readonly Readonly<Record<string, unknown>>[]>(),
    occurredAt: timestamp("occurred_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    provenance: doorProvenanceEnum("provenance").notNull(),
    /** The line verbatim — the authority. NULL only on a mirror projection the one-time import has not filled. */
    record: jsonb("record").$type<Readonly<Record<string, unknown>>>(),
    /**
     * SHA-256 of the physical line plus its zero-padded line number for an imported line, so a second apply is
     * a no-op; `written:<uuid>` for a row the door wrote itself.
     */
    importKey: text("import_key").notNull(),
  },
  (table) => [
    uniqueIndex("uq_door_event_import_key").on(table.importKey),
    uniqueIndex("uq_door_event_seq").on(table.seq),
    check("door_event_record_is_object", sql`record is null or jsonb_typeof(record) = 'object'`),
    // `seq` is read as a JavaScript number and paged by keyset, so a value a number cannot hold exactly would let
    // the import's read-back step over a row. The sequence never gets near it; a row written by hand cannot either.
    check("door_event_seq_is_safe", sql`seq between 1 and 9007199254740991`),
    // Every "what has this install done" query is this shape, and the provenance column leads it so the
    // unattributable era is excluded by the index rather than by a filter someone has to remember.
    index("idx_door_event_provenance_time").on(table.provenance, table.occurredAt.desc()),
    index("idx_door_event_action_time").on(table.action, table.occurredAt.desc()),
    index("idx_door_event_status").on(table.status),
    index("idx_door_event_duplicate_key").on(table.duplicateKey),
    // The ledger records targets and policy prose from private channels. Denied to the bot outright.
    ...storeTablePolicies({ botRead: sql`false`, table: "door_event" }),
  ],
);

/** The only primary-key value `door_register` accepts, spelled once so a reader and the CHECK agree. */
export const DOOR_REGISTER_ID = "door";

/**
 * Whether the one-time import of the home's door ledger has completed — one row, or none.
 *
 * `door_event` alone cannot say this: a mirror import may already have written most of the file's lines, and a
 * populated table is not proof the LAST lines landed or that every row carries its verbatim `record`. So the
 * import writes this row LAST, once every line was inserted or filled in and read back without a divergence, and
 * `../../admit/doorStorePort.ts` refuses with `DOOR_NOT_IMPORTED` until it stands.
 */
export const doorRegisterTable = pgTable(
  "door_register",
  {
    id: text("id").primaryKey(),
    importedAt: timestamp("imported_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("door_register_is_singleton", sql.raw(`id = '${DOOR_REGISTER_ID}'`)),
    ...storeTablePolicies({ botRead: sql`false`, table: "door_register" }),
  ],
);

/**
 * Which of the register's two line shapes a row is.
 *
 * `../../autonomy/types.ts` carries both: an `AutonomyActionRow` is what a session DID, an
 * `AutonomySteerRow` is the owner's retroactive word about one, appended later by a different session. They are one
 * table because they are one register and every reader wants them interleaved by time; they are told apart
 * by a column because their required fields are disjoint, and a shape that hid that distinction would hide
 * the one the whole register is about.
 */
export const autonomyEntryEnum = pgEnum("autonomy_entry", ["action", "steer"]);

/**
 * Every act the fleet took on the owner's behalf without asking, and every retroactive word the owner gave about one —
 * AGENTS.md rule 10's recording half.
 *
 * ## The record, not a mirror
 *
 * This table IS the autonomy ledger: `slopweaver autonomy record|steer|steer-class` and every verb that acts
 * unasked insert here, and every reader reads here, through `../../autonomy/port.ts`.
 * `$SLOPWEAVER_HOME/ledgers/autonomy.jsonl` is only the source of the one-time `store import-fleet --only
 * autonomy`, and {@link autonomyRegisterTable} records that it ran.
 *
 * `record` is the validated record verbatim, and it is the authority: the scalar columns are projections of it
 * for the indexes, because an act carries fields no column names (`said`, a class steer's `kinds`, `anchor` and
 * `subjectPrefix`) and an instant whose precision `occurred_at` cannot hold. A row whose `record` is NULL is a
 * projection an import wrote before this table became the ledger: it is kept, and read by nothing. So the one
 * action per id the file's writer enforced is a partial unique index over authority rows only, and `seq` is
 * the order every read takes — `occurred_at` is a claimed instant, and the owner's last word on an act is the last one
 * WRITTEN.
 *
 * `why` and `witness` are the fields that make an act checkable rather than asserted, and
 * `../../autonomy/row.ts` refuses to write an action without them. They are nullable in the DDL only
 * because a `steer` line legitimately has neither, and the CHECK below is what keeps that from becoming a
 * licence: an `action` must carry both, a `steer` must carry a `steer` and neither of them. The same
 * cross-column shape `./memories.ts` uses for its lesson facets, and for the same reason — enforced where a
 * write is checked, rather than in a convention a writer has to remember.
 */
export const autonomyEventTable = pgTable(
  "autonomy_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Insert order — what the register's line order was. Every read orders by it. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    /** The ledger's own id for the act. A steer names the action it judges, so this is NOT unique. */
    actionId: text("action_id").notNull(),
    entryKind: autonomyEntryEnum("entry_kind").notNull(),
    /** What was done — `github.pr.enqueue`, `press-merge-when-ready`, and their refusal variants. */
    kind: text("kind"),
    /** What it was done TO: a pull request URL, a thread permalink. */
    subject: text("subject"),
    /** Why a session judged this obvious enough to do unasked. The field the owner actually reads. */
    why: text("why"),
    /** The verb that was run and the line it printed. */
    witness: text("witness"),
    /** The owner's word about the act. Present on a `steer` line, and on an `action` whose recorder already had one. */
    steer: text("steer"),
    /** The board row it was done on, when the acting session was executing one. */
    run: text("run"),
    /** Which session did it, or — on a steer — which session wrote the owner's word down. Provenance, never proof. */
    bySession: text("by_session"),
    /** `doneIso` on an action, `steeredIso` on a steer. One column so the register reads in time order. */
    occurredAt: timestamp("occurred_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    /** The validated record verbatim — the authority. NULL only on a projection written before it was. */
    record: jsonb("record").$type<Readonly<Record<string, unknown>>>(),
    importKey: text("import_key").notNull(),
  },
  (table) => [
    uniqueIndex("uq_autonomy_event_import_key").on(table.importKey),
    uniqueIndex("uq_autonomy_event_seq").on(table.seq),
    // One act per id, among authority rows. Two sessions recording the same id race here, and the loser reads
    // the winner back rather than appending a second act.
    uniqueIndex("uq_autonomy_event_one_action")
      .on(table.actionId)
      .where(sql`entry_kind = 'action' and record is not null`),
    check("autonomy_event_record_is_object", sql`record is null or jsonb_typeof(record) = 'object'`),
    // The Fleet Briefing's "done for you, without asking" section is exactly this query.
    index("idx_autonomy_event_time").on(table.occurredAt.desc()),
    index("idx_autonomy_event_kind_time").on(table.kind, table.occurredAt.desc()),
    index("idx_autonomy_event_subject").on(table.subject),
    // "the owner's word on this act", which is the join the register exists to make.
    index("idx_autonomy_event_action").on(table.actionId, table.entryKind),
    check(
      "autonomy_event_entry_fields",
      sql`(entry_kind = 'action' and kind is not null and subject is not null
            and why is not null and witness is not null)
        or (entry_kind = 'steer' and steer is not null and why is null and witness is null)`,
    ),
    ...storeTablePolicies({ botRead: sql`false`, table: "autonomy_event" }),
  ],
);

/** The only primary-key value `autonomy_register` accepts, spelled once so a reader and the CHECK agree. */
export const AUTONOMY_REGISTER_ID = "autonomy";

/**
 * Whether the one-time import of the home's autonomy register has completed — one row, or none.
 *
 * `autonomy_event` alone cannot say this: an empty table is both "nothing was ever done autonomously" and "the
 * register has not been imported yet", and reading the second as the first is a confident false history on the
 * one surface built to catch false answers. So the import writes this row LAST, once every line was inserted
 * and read back without a divergence, and `../../autonomy/storePort.ts` refuses with `AUTONOMY_NOT_IMPORTED`
 * while a register file stands beside a store with no row here.
 */
export const autonomyRegisterTable = pgTable(
  "autonomy_register",
  {
    id: text("id").primaryKey(),
    importedAt: timestamp("imported_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    check("autonomy_register_is_singleton", sql.raw(`id = '${AUTONOMY_REGISTER_ID}'`)),
    ...storeTablePolicies({ botRead: sql`false`, table: "autonomy_register" }),
  ],
);

/**
 * Journalled grants — a decision the owner already made, written down so the session that performs it can check it.
 *
 * Named `grant_row`, not `grant`, and that is forced rather than a preference: `GRANT` is a reserved word,
 * and `../policies.ts`'s `storeTableGrantStatements` builds `grant select on <table> to …` as raw,
 * UNQUOTED SQL over every name `declared.ts` reports. A table called `grant` would emit
 * `grant select on grant to …`, which is a syntax error at the exact moment the apply loop installs the
 * grants — after the migration has already succeeded. The `_row` suffix matches `board_row` on the same
 * design page.
 *
 * ## The record, not a mirror
 *
 * This table IS the grant journal: `slopweaver grant record|perform|refuse` insert here and `grant show|list`
 * read here, through `../../grants/port.ts`. `$SLOPWEAVER_HOME/grants/journal.jsonl` is only the source of the
 * one-time `store import-fleet --only grants`, read by nothing else.
 *
 * Two properties the file gave by being one append-only file are the database's to keep now, so both are
 * DDL rather than a writer's convention:
 *
 * - **Order.** `grant list` names a row's LAST refusal, so the journal's order is observable, and neither
 *   `recorded_at` (a claimed instant, tied at millisecond precision) nor the random `id` reproduces it. `seq`
 *   is assigned at insert, and the importer inserts in physical line order.
 * - **One row, one change.** At most one `grant` and one `performance` row per `grant_id`, by the two partial
 *   unique indexes below. A derived `import_key` alone could not hold this: a legacy line keeps its line-hash
 *   key, so a new performance of an imported, already-performed grant would not collide on it. Refusals are
 *   many by design.
 */
export const grantRowTable = pgTable(
  "grant_row",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Insert order — what the journal's line order was. Every read orders by it. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    /** The grant id a session passes to `grant show` and `grant perform`. */
    grantId: text("grant_id").notNull(),
    /** `record`, `perform` or `refuse` — which of the three journal shapes this line is. */
    entryKind: text("entry_kind").notNull(),
    targetFile: text("target_file"),
    /** `literal` or `diff`. */
    changeKind: text("change_kind"),
    /** The exact change the row authorises, byte for byte — what `perform` compares a read-back against. */
    change: text("change"),
    anchor: text("anchor"),
    /** The refusal code, on a `refuse` line. A closed set, validated at parse time upstream. */
    refusalCode: text("refusal_code"),
    /** What the refusing session observed, or what the performing session wrote. */
    detail: text("detail"),
    bySession: text("by_session"),
    recordedAt: timestamp("recorded_at", { mode: "date", precision: 3, withTimezone: true }).notNull(),
    /** The line verbatim, so a field this table does not name is still recoverable from the row. */
    entry: jsonb("entry").$type<Readonly<Record<string, unknown>>>().notNull(),
    importKey: text("import_key").notNull(),
  },
  (table) => [
    uniqueIndex("uq_grant_row_import_key").on(table.importKey),
    uniqueIndex("uq_grant_row_seq").on(table.seq),
    // One row is one change, spent by one performance — `.claude/rules/journalled-grants.md`. The race between
    // two performers, or a performer and the import, is lost here rather than in a check-then-append.
    uniqueIndex("uq_grant_row_one_grant")
      .on(table.grantId)
      .where(sql`entry_kind = 'grant'`),
    uniqueIndex("uq_grant_row_one_performance")
      .on(table.grantId)
      .where(sql`entry_kind = 'performance'`),
    // "everything that ever happened to this grant", which is what `grant show` renders.
    index("idx_grant_row_grant_time").on(table.grantId, table.recordedAt),
    index("idx_grant_row_kind_time").on(table.entryKind, table.recordedAt.desc()),
    ...storeTablePolicies({ botRead: sql`false`, table: "grant_row" }),
  ],
);

/** A door decision as the database returns it. */
export type DoorEventRecord = typeof doorEventTable.$inferSelect;

/** A door decision as an insert takes it. */
export type NewDoorEventRecord = typeof doorEventTable.$inferInsert;

/** An autonomous act as the database returns it. */
export type AutonomyEventRecord = typeof autonomyEventTable.$inferSelect;

/** An autonomous act as an insert takes it. */
export type NewAutonomyEventRecord = typeof autonomyEventTable.$inferInsert;

/** A grant journal line as the database returns it. */
export type GrantRowRecord = typeof grantRowTable.$inferSelect;

/** A grant journal line as an insert takes it. */
export type NewGrantRowRecord = typeof grantRowTable.$inferInsert;
