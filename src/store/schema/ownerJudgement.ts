/**
 * The owner's directives and per-subject corrections, as the store tables that ARE their authority.
 *
 * `src/judgement/ownerDirective.ts` carries the domain: a directive is a durable instruction distilled from a
 * feedback memory, a correction is one that names the exact subject it corrects. These two tables are where both
 * LIVE. The old `judgement/owner-directives.json` overlay is imported once (`./homeFileImport.ts`, register
 * `owner-judgement`) and never read again.
 *
 * ## Versions, never edits
 *
 * A row is one VERSION of one logical instruction. Replacing an instruction deactivates the active version and
 * inserts the new one in the same transaction; revoking one deactivates it. Nothing deletes a row, so an
 * inactive version stays on the record beside the active one, and the partial unique index on the logical id
 * where `state = 'active'` is the final guard that at most one version of each id ever steers anything.
 *
 * `inactive` exists from the start for a second reason: a restored instruction an import carried must be
 * storable without steering a turn, and becoming active is an explicit state transition after the owner's
 * answer. `import_question_id` is the witness that ties such a row to the question it answered, unique so an
 * apply cannot land the same answer twice; a row written by the memory hook carries none.
 *
 * ## Every version names the writer that produced it
 *
 * `origin` is `legacy-file` for a version the one-time import wrote, `memory` for one a memory event wrote, and
 * `store-import` for one an applied store import will write. It never changes: a memory event that replaces or
 * revokes a legacy version retires it, and the retired row KEEPS `legacy-file`. That is what lets the import
 * marker be checked exactly — the rows with `origin = 'legacy-file'`, in either state and across both tables,
 * are precisely the rows the import wrote, so a count below the marker's is a loss no memory-written version
 * beside it can mask.
 *
 * ## Two tables, two id spaces
 *
 * Directives and corrections keep separate id spaces in the domain, and a correction carries a subject a
 * directive must never acquire, so they are separate tables rather than one with a nullable kind. The subject
 * tuple is indexed because `correctionsForSubjects` matches it exactly.
 *
 * `source_modified` stays text: the domain promises a string or null, and respelling it as a timestamp would
 * change the portable fingerprint an export computes over it.
 *
 * The bot is denied both tables, as it is every judgement table.
 */
import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { storeImportQuestionTable } from "./importStaging.js";
import { storeTablePolicies } from "./rls.js";

/** Whether one version of an instruction steers anything. */
export const judgementInstructionStateEnum = pgEnum("judgement_instruction_state", ["active", "inactive"]);

/**
 * Which writer produced one version: the one-time import of the legacy file, a memory event, or a staged store
 * import's applied answer (`store import --apply`).
 */
export const ownerJudgementOriginEnum = pgEnum("owner_judgement_origin", ["legacy-file", "memory", "store-import"]);

/** One version of one owner directive. */
export const ownerDirectiveTable = pgTable(
  "owner_directive",
  {
    rowId: uuid("row_id").primaryKey().defaultRandom(),
    /** The logical directive id, shared by every version of it. */
    directiveId: text("directive_id").notNull(),
    state: judgementInstructionStateEnum("state").notNull(),
    /** Which writer produced this version; a retired legacy version keeps `legacy-file`. */
    origin: ownerJudgementOriginEnum("origin").notNull(),
    text: text("text").notNull(),
    /** The memory file the directive was distilled from. */
    sourceFile: text("source_file").notNull(),
    sourceContentHash: text("source_content_hash").notNull(),
    sourceModified: text("source_modified"),
    /** The import question this version answered, when an import landed it. */
    importQuestionId: text("import_question_id")
      .unique("uq_owner_directive_import_question")
      .references(() => storeImportQuestionTable.id),
    recordedAt: timestamp("recorded_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("uq_owner_directive_active")
      .on(table.directiveId)
      .where(sql`state = 'active'`),
    index("idx_owner_directive_state").on(table.state, table.directiveId),
    check("owner_directive_id", sql`directive_id <> ''`),
    check("owner_directive_text", sql`text <> ''`),
    check("owner_directive_source_hash", sql`source_content_hash ~ '^sha256:[0-9a-f]{64}$'`),
    check("owner_directive_import_origin", sql`(origin = 'store-import') = (import_question_id is not null)`),
    ...storeTablePolicies({ botRead: sql`false`, table: "owner_directive" }),
  ],
);

/** One version of one owner correction, with the exact subject it corrects. */
export const ownerCorrectionTable = pgTable(
  "owner_correction",
  {
    rowId: uuid("row_id").primaryKey().defaultRandom(),
    /** The logical correction id, shared by every version of it. */
    correctionId: text("correction_id").notNull(),
    state: judgementInstructionStateEnum("state").notNull(),
    /** Which writer produced this version; a retired legacy version keeps `legacy-file`. */
    origin: ownerJudgementOriginEnum("origin").notNull(),
    text: text("text").notNull(),
    /** The memory file the correction was distilled from. */
    sourceFile: text("source_file").notNull(),
    sourceContentHash: text("source_content_hash").notNull(),
    sourceModified: text("source_modified"),
    subjectSource: text("subject_source").notNull(),
    subjectContainer: text("subject_container").notNull(),
    subjectSourceId: text("subject_source_id").notNull(),
    subjectUrl: text("subject_url"),
    /** The import question this version answered, when an import landed it. */
    importQuestionId: text("import_question_id")
      .unique("uq_owner_correction_import_question")
      .references(() => storeImportQuestionTable.id),
    recordedAt: timestamp("recorded_at", { mode: "date", precision: 3, withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("uq_owner_correction_active")
      .on(table.correctionId)
      .where(sql`state = 'active'`),
    index("idx_owner_correction_state").on(table.state, table.correctionId),
    index("idx_owner_correction_subject").on(table.subjectSource, table.subjectContainer, table.subjectSourceId),
    check("owner_correction_id", sql`correction_id <> ''`),
    check("owner_correction_text", sql`text <> ''`),
    check(
      "owner_correction_subject",
      sql`subject_source <> '' and subject_container <> '' and subject_source_id <> ''`,
    ),
    check("owner_correction_source_hash", sql`source_content_hash ~ '^sha256:[0-9a-f]{64}$'`),
    check("owner_correction_import_origin", sql`(origin = 'store-import') = (import_question_id is not null)`),
    ...storeTablePolicies({ botRead: sql`false`, table: "owner_correction" }),
  ],
);

/** A directive version as the database returns it. */
export type OwnerDirectiveRow = typeof ownerDirectiveTable.$inferSelect;
/** A correction version as the database returns it. */
export type OwnerCorrectionRow = typeof ownerCorrectionTable.$inferSelect;
