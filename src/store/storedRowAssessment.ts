/**
 * What the daily visible reader is asked to classify among the rows the store already holds, and how its answer is
 * checked — the pure half. The store reads are `./storedRowAssessmentRead.ts`; the verbs are `store assessment-due`
 * and `store assessment-record`; the register the verdicts land in is `./recordedDataClassAssessment.ts`.
 *
 * ## Which rows are due
 *
 * A row is due when the composed rules send it for assessment NOW (`./dataClassRules.ts`'s `needs-assessment`: by
 * default every `owner_capture` and `owner_turn` row, and every private-lane `content` row) and the register holds no
 * verdict for that row, under that rule, over the digest of its current words. So an installation rule that already
 * classifies a row takes it off the list, words that change make a row due again, and a routing change asks again.
 * An `undecided` verdict is a verdict: the row stays `unknown`, and it is not asked about again until its words move.
 *
 * ## A day's slice, never the whole backlog
 *
 * Private-lane `content` alone can be every mailbox and direct-message row the store holds, far more than one visible
 * session reads in an evening. So a firing is bounded: at most {@link STORED_ROW_ASSESSMENT_DAILY_LIMIT} stored-row
 * verdicts are recorded per local calendar day, newest rows first, and the day's check is satisfied once that many are
 * recorded or nothing is due, whichever comes first. An older backlog is REPORTED (`moreDue`), never a reason to seat
 * the reader again the same day — a check that waited for the whole backlog would reseat forever.
 *
 * Pure: no store, no clock, no filesystem.
 */
import { z } from "zod";

import { parseJson } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";

import {
  ASSIGNABLE_DATA_CLASSES,
  DATA_CLASS_RULE_TABLES,
  type DataClassAssessmentVerdict,
  type DataClassFacts,
  type DataClassRule,
  type DataClassRuleTable,
  sortDataClass,
} from "./dataClassRules.js";
import {
  type RecordedDataClassAssessment,
  type RecordedStoredRowAssessment,
  storedRowAssessmentKey,
} from "./recordedDataClassAssessment.js";

/**
 * The most stored-row verdicts one local calendar day records: the daily firing's slice. A bound on how much private
 * text one seat reads, not a tunable throughput.
 */
export const STORED_ROW_ASSESSMENT_DAILY_LIMIT = 25;

/**
 * The most characters one stored-row verdict's reason may carry, the same bound a call passage's reason has.
 *
 * @internal — exported so the test judges the bound's edge.
 */
export const STORED_ROW_REASON_MAX_CHARS = 300;

/** One stored row as the due list reads it: its key, its facts, when it happened and the digest of its words. */
export interface StoredRowAssessmentCandidate {
  readonly table: DataClassRuleTable;
  readonly rowId: string;
  readonly facts: DataClassFacts;
  /** The row's own instant as ISO text: when it occurred, was said, or (an `owner_turn`) was first imported. */
  readonly orderAtIso: string;
  /** The digest of the row's words, computed by the store (`./storedRowAssessmentRead.ts`). */
  readonly requestSha256: string;
}

/** One stored row due for a verdict: a candidate and the rule that sent it. */
export interface DueStoredRow extends StoredRowAssessmentCandidate {
  readonly ruleId: string;
}

/**
 * The rule that sends a row for assessment now, or `undefined` when the rules classify it or leave it unmatched.
 *
 * @param facts the row's current facts
 * @param rules the composed rules
 * @returns the routing rule's id, or `undefined`
 */
export function assessmentRuleFor({
  facts,
  rules,
}: {
  facts: DataClassFacts;
  rules: readonly DataClassRule[];
}): string | undefined {
  const outcome = sortDataClass({ facts, rules });
  if (outcome.kind === "needs-assessment") {
    return outcome.ruleId;
  }
  return undefined;
}

/**
 * The rows of one page still due: sent for assessment by the current rules and with no verdict for their current
 * words under that rule.
 *
 * @param page candidates, in the order read
 * @param assessed the register's stored-row verdicts by key (`./recordedDataClassAssessment.ts`'s index)
 * @returns the due rows, in page order
 */
export function dueStoredRows({
  page,
  rules,
  assessed,
}: {
  page: readonly StoredRowAssessmentCandidate[];
  rules: readonly DataClassRule[];
  assessed: ReadonlyMap<string, RecordedStoredRowAssessment>;
}): readonly DueStoredRow[] {
  const due: DueStoredRow[] = [];
  for (const candidate of page) {
    const ruleId = assessmentRuleFor({ facts: candidate.facts, rules });
    if (ruleId === undefined) {
      continue;
    }
    const key = storedRowAssessmentKey({
      requestSha256: candidate.requestSha256,
      rowId: candidate.rowId,
      ruleId,
      table: candidate.table,
    });
    if (!assessed.has(key)) {
      due.push({ ...candidate, ruleId });
    }
  }
  return due;
}

/**
 * Whether two instants fall on the same calendar day in the machine's own time zone, the zone the daily row fires in.
 *
 * @param aMs one instant
 * @param bMs the other
 * @returns true on the same local day
 */
function sameLocalDay({ aMs, bMs }: { aMs: number; bMs: number }): boolean {
  return new Date(aMs).toDateString() === new Date(bMs).toDateString();
}

/**
 * How many stored-row verdicts were recorded on the local calendar day `nowMs` falls in.
 *
 * @param records the register's assessments
 * @param nowMs the instant the day is judged at
 * @returns the day's count
 */
export function storedRowsAssessedToday({
  records,
  nowMs,
}: {
  records: readonly RecordedDataClassAssessment[];
  nowMs: number;
}): number {
  return records.filter(
    (record) => record.version === 2 && sameLocalDay({ aMs: Date.parse(record.recordedAtIso), bMs: nowMs }),
  ).length;
}

/** The day's slice: what is due now, newest first, and what the day has already used. */
export interface StoredRowAssessmentSlice {
  /** At most the day's remaining capacity, newest first. */
  readonly due: readonly DueStoredRow[];
  readonly assessedToday: number;
  readonly remaining: number;
  /** True when a due row exists beyond {@link due}: the backlog the day's slice did not reach. */
  readonly moreDue: boolean;
}

/**
 * Order due rows newest first, ties broken by table then row id so two reads list the same rows in the same order.
 *
 * @param rows the due rows, from any tables
 * @returns them, newest first
 */
export function newestFirst({ rows }: { rows: readonly DueStoredRow[] }): readonly DueStoredRow[] {
  return rows.toSorted((a, b) => {
    const byTime = Date.parse(b.orderAtIso) - Date.parse(a.orderAtIso);
    if (byTime !== 0) {
      return byTime;
    }
    if (a.table !== b.table) {
      return a.table < b.table ? -1 : 1;
    }
    if (a.rowId === b.rowId) {
      return 0;
    }
    return a.rowId < b.rowId ? -1 : 1;
  });
}

/**
 * The day's slice from every table's newest due rows: each table read until it yielded one more due row than the
 * day's remaining capacity, or ran out, so the merge sees every row the slice could hold and one past it.
 *
 * @param perTable each table's newest due rows
 * @param assessedToday the day's stored-row verdicts so far
 * @param limit the day's capacity
 * @returns the slice
 */
export function storedRowAssessmentSlice({
  perTable,
  assessedToday,
  limit,
}: {
  perTable: readonly (readonly DueStoredRow[])[];
  assessedToday: number;
  limit: number;
}): StoredRowAssessmentSlice {
  const remaining = Math.max(0, limit - assessedToday);
  const merged = newestFirst({ rows: perTable.flat() });
  return { assessedToday, due: merged.slice(0, remaining), moreDue: merged.length > remaining, remaining };
}

/** One entry of a verdicts file, as the session writes it. */
const verdictEntrySchema = z
  .object({
    class: z.enum([...ASSIGNABLE_DATA_CLASSES, "undecided"]),
    reason: z.string(),
    requestSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    rowId: z.string().min(1),
    ruleId: z.string().min(1),
    table: z.enum(DATA_CLASS_RULE_TABLES),
  })
  .strict();

/** The verdicts file: one entry per row the session classified. */
const verdictsFileSchema = z.object({ verdicts: z.array(verdictEntrySchema).min(1) }).strict();

/** One row's verdict as the session wrote it, checked for shape. */
export interface StoredRowVerdict {
  readonly table: DataClassRuleTable;
  readonly rowId: string;
  readonly ruleId: string;
  readonly requestSha256: string;
  readonly verdict: DataClassAssessmentVerdict;
}

/** The verdicts file was refused before anything was recorded. */
export interface StoredRowVerdictsInvalidError {
  readonly code: "STORED_ROW_VERDICTS_INVALID";
  readonly message: string;
  readonly problems: readonly string[];
}

/**
 * The factories this module's refusals are built through.
 *
 * @internal — exported so a test builds the same refusal the parser does.
 */
export const StoredRowAssessmentErrors = {
  verdictsInvalid: ({ problems }: { problems: readonly string[] }): StoredRowVerdictsInvalidError => ({
    code: "STORED_ROW_VERDICTS_INVALID",
    message: `the stored-row verdicts were refused, so nothing was recorded: ${problems.join("; ")}`,
    problems,
  }),
} as const;

/** Each table's key shape: a uuid, or the lower-case hex digest `owner_turn` is keyed by. */
const ROW_KEY_SHAPES: Readonly<Record<DataClassRuleTable, RegExp>> = {
  content: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
  owner_capture: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
  owner_turn: /^[0-9a-f]{64}$/u,
};

/**
 * Whether a row key has its table's shape, so a malformed one is refused before it reaches the store.
 *
 * @param rowId the key as written
 * @returns true when it has the shape
 */
export function rowKeyFits({ table, rowId }: { table: DataClassRuleTable; rowId: string }): boolean {
  return ROW_KEY_SHAPES[table].test(rowId);
}

/**
 * One entry's reason problem, or `undefined` when it is a sentence within the bound.
 *
 * @param reason the reason as written
 * @param where the entry's position, named in the problem
 * @returns the problem, or `undefined`
 */
function reasonProblem({ reason, where }: { reason: string; where: string }): string | undefined {
  if (reason.trim() === "") {
    return `${where} gives no reason`;
  }
  if (reason.length > STORED_ROW_REASON_MAX_CHARS) {
    return `${where}'s reason is ${String(reason.length)} characters, over ${String(STORED_ROW_REASON_MAX_CHARS)}`;
  }
  return undefined;
}

/**
 * Parse a stored-row verdicts file: `{"verdicts":[{"table","rowId","ruleId","requestSha256","class","reason"}]}`.
 * A malformed file, a blank or over-long reason, or one row named twice refuses the whole file.
 *
 * @param text the file's text
 * @returns each row's verdict, in file order, or why the file was refused
 */
export function parseStoredRowVerdictsFile({
  text,
}: {
  text: string;
}): Result<readonly StoredRowVerdict[], StoredRowVerdictsInvalidError> {
  const value = parseJson({ text });
  if (value.isErr()) {
    return err(StoredRowAssessmentErrors.verdictsInvalid({ problems: ["the verdicts file is not JSON"] }));
  }
  const parsed = verdictsFileSchema.safeParse(value.value);
  if (!parsed.success) {
    return err(
      StoredRowAssessmentErrors.verdictsInvalid({
        problems: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      }),
    );
  }
  const problems: string[] = [];
  const seen = new Set<string>();
  const verdicts: StoredRowVerdict[] = [];
  parsed.data.verdicts.forEach((entry, index) => {
    const where = `verdicts.${String(index)} (${entry.table}/${entry.rowId})`;
    const problem = reasonProblem({ reason: entry.reason, where });
    if (problem !== undefined) {
      problems.push(problem);
    }
    if (!rowKeyFits({ rowId: entry.rowId, table: entry.table })) {
      problems.push(`${where} names a row key that is not a ${entry.table} key`);
    }
    const row = `${entry.table}/${entry.rowId}`;
    if (seen.has(row)) {
      problems.push(`${where} names a row already named earlier in the file`);
    }
    seen.add(row);
    let verdict: DataClassAssessmentVerdict = { kind: "undecided", reason: entry.reason };
    if (entry.class !== "undecided") {
      verdict = { dataClass: entry.class, kind: "classified", reason: entry.reason };
    }
    verdicts.push({
      requestSha256: entry.requestSha256,
      rowId: entry.rowId,
      ruleId: entry.ruleId,
      table: entry.table,
      verdict,
    });
  });
  if (problems.length > 0) {
    return err(StoredRowAssessmentErrors.verdictsInvalid({ problems }));
  }
  return ok(verdicts);
}

/** Why one row's verdict cannot be recorded against the row as the store holds it now. */
export type StoredRowVerdictMismatch =
  | { readonly kind: "row-absent" }
  | { readonly kind: "not-sent-for-assessment" }
  | { readonly kind: "rule-moved"; readonly currentRuleId: string }
  | { readonly kind: "words-moved"; readonly currentSha256: string };

/**
 * Check one verdict against the row as the store holds it now: still present, still sent for assessment under the
 * same rule, and holding the same words.
 *
 * @param verdict the session's verdict
 * @param current the row's current facts and digest, or `undefined` when the store no longer holds it
 * @param rules the composed rules
 * @returns why it cannot be recorded, or `undefined` when it can
 */
export function storedRowVerdictMismatch({
  verdict,
  current,
  rules,
}: {
  verdict: StoredRowVerdict;
  current: { readonly facts: DataClassFacts; readonly requestSha256: string } | undefined;
  rules: readonly DataClassRule[];
}): StoredRowVerdictMismatch | undefined {
  if (current === undefined) {
    return { kind: "row-absent" };
  }
  const ruleId = assessmentRuleFor({ facts: current.facts, rules });
  if (ruleId === undefined) {
    return { kind: "not-sent-for-assessment" };
  }
  if (ruleId !== verdict.ruleId) {
    return { currentRuleId: ruleId, kind: "rule-moved" };
  }
  if (current.requestSha256 !== verdict.requestSha256) {
    return { currentSha256: current.requestSha256, kind: "words-moved" };
  }
  return undefined;
}

/**
 * The one line a mismatch prints: the row and what moved, never anything the row holds.
 *
 * @param verdict the refused verdict
 * @param mismatch what moved
 * @returns the line
 */
export function storedRowMismatchLine({
  verdict,
  mismatch,
}: {
  verdict: StoredRowVerdict;
  mismatch: StoredRowVerdictMismatch;
}): string {
  const row = `${verdict.table}/${verdict.rowId}`;
  if (mismatch.kind === "row-absent") {
    return `${row}: the store no longer holds this row, so nothing was recorded for it`;
  }
  if (mismatch.kind === "not-sent-for-assessment") {
    return `${row}: the rules no longer send this row for assessment, so nothing was recorded for it`;
  }
  if (mismatch.kind === "rule-moved") {
    return `${row}: it is now sent for assessment by ${mismatch.currentRuleId}, not ${verdict.ruleId}; read store assessment-due again`;
  }
  return (
    `${row}: its words changed since they were read (digest is now ${mismatch.currentSha256.slice(0, 12)}), ` +
    "so nothing was recorded for it; read store assessment-due again"
  );
}
