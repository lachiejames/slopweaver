/**
 * `supervisor tick fill`'s pure half: one set of edits applied to the tick file `tick open` wrote, every added row
 * judged against the ledger's own authored shapes before anything is kept.
 *
 * ## Why a verb writes the tick form
 *
 * MEASURED over 17 successive passes: the chair
 * derived every pass's form from the last with `jq --rawfile f1 f1-N.txt -f patch-N.jq patch-(N-1).json` run as a
 * background job, then edited the harness's exit trailer out of each output before `tick close` would read it. jq is
 * banned in this repo; every job is a command of our own. The jobs those patches
 * did are the flags here — carry the last pass's folds and judgements forward, replace the headline, set one fold
 * from a file, add or replace an action or a judgement by its id — and the verb writes the file itself, so there is
 * no redirect and no trailer.
 *
 * A partial fill is legal, so the WHOLE form is not judged here: {@link tickFormIssues} reports what `tick close`
 * would still refuse, and close stays the gate.
 *
 * Pure: documents in, a document or every issue out.
 */
import type { z } from "zod";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { authoredJudgementSchema } from "./tickAuthoredJudgement.js";
import { foldWordingIssues } from "./tickFoldWording.js";
import { authoredActionSchema, parseTickInput } from "./tickInput.js";
import { type TickWorkflowError, TickWorkflowErrors } from "./tickWorkflowErrors.js";

/** The fields `--carry-from` copies off an earlier tick's form: what a pass restates, never what it authors anew. */
const CARRIED_FIELDS = ["folds", "foldSummary", "judgements", "sleeping"] as const;

/** Every edit one `tick fill` makes; an absent field leaves the form's own value. */
export interface TickFillEdits {
  /** An earlier tick's form, whose {@link CARRIED_FIELDS} are copied first so every other edit lands on them. */
  readonly carried: Readonly<Record<string, unknown>> | undefined;
  readonly headline: readonly string[] | undefined;
  /** The folds, replacing the list — or, with {@link TickFillEdits.foldAt}, the ONE fold at that index. */
  readonly folds: readonly string[] | undefined;
  readonly foldAt: number | undefined;
  readonly foldSummary: string | undefined;
  readonly lede: string | undefined;
  readonly alignmentSummary: string | undefined;
  readonly earlierSummary: string | undefined;
  readonly alignmentDetails: readonly string[] | undefined;
  readonly dropCards: readonly string[] | undefined;
  readonly sleeping: boolean | undefined;
  readonly openPagesReviewed: boolean | undefined;
  /** The next sweep's shift line; `null` sets the quiet line. */
  readonly shift: string | null | undefined;
  /** Rows replacing the action with the same `actionId`, or appended. */
  readonly actions: readonly unknown[];
  /** Rows replacing the judgement with the same `judgementId`, or appended. */
  readonly judgements: readonly unknown[];
  readonly dropActions: readonly string[];
  readonly dropJudgements: readonly string[];
}

/** One applied fill: the new form, and the fields it changed, in the order a reader scans them. */
export interface TickFillResult {
  readonly form: Readonly<Record<string, unknown>>;
  readonly changed: readonly string[];
}

/** A form, or one row in it, read as fields. */
type Row = Readonly<Record<string, unknown>>;

/**
 * The rows of one list field, refusing a field that is present but not a list.
 *
 * @param form the form
 * @param field the list field
 * @param issues where a malformed field is named
 * @returns the rows, empty when the field is absent
 */
function rowsOf({ form, field, issues }: { form: Row; field: string; issues: string[] }): readonly unknown[] {
  const value = form[field];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push(`${field}: is not a list in the tick file, so no row can be added to it`);
    return [];
  }
  return value;
}

/**
 * Each row parsed against its authored schema, every issue named by the row's position in its source.
 *
 * @param rows the rows as read
 * @param schema the authored action or judgement schema
 * @param source what the rows came from, for the issue path
 * @param issues where each refusal is named
 * @returns the rows that parsed
 */
function parsedRows<S extends z.ZodType>({
  rows,
  schema,
  source,
  issues,
}: {
  rows: readonly unknown[];
  schema: S;
  source: string;
  issues: string[];
}): readonly z.output<S>[] {
  const kept: z.output<S>[] = [];
  rows.forEach((row, index) => {
    const parsed = schema.safeParse(row);
    if (parsed.success) {
      kept.push(parsed.data);
      return;
    }
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join(".");
      issues.push(`${source}[${String(index)}]${path.length === 0 ? "" : `.${path}`}: ${issue.message}`);
    }
  });
  return kept;
}

/**
 * A list with each id dropped and each new row put in place of the one carrying its id, or appended.
 *
 * @param existing the form's rows
 * @param given the rows as read, before parsing, so an id clash is named at its position in the file
 * @param added the parsed rows to put in
 * @param drops the ids to remove
 * @param idKey which field is the row's id
 * @param field the form field, for the issue path
 * @param issues where an unknown drop is named
 * @returns the new list
 */
function upserted({
  existing,
  given,
  added,
  drops,
  idKey,
  field,
  issues,
}: {
  existing: readonly unknown[];
  given: readonly unknown[];
  added: readonly Row[];
  drops: readonly string[];
  idKey: string;
  field: string;
  issues: string[];
}): readonly unknown[] {
  const idOf = ({ row }: { row: unknown }): unknown => (isRecord(row) ? row[idKey] : undefined);
  for (const drop of drops) {
    if (!existing.some((row) => idOf({ row }) === drop)) {
      issues.push(`${field}: no row with ${idKey} "${drop}" to drop`);
    }
  }
  // Read over the rows as given, not only those that parsed, so a clash is named even beside a bad row.
  given.forEach((row, index) => {
    const id = idOf({ row });
    if (typeof id !== "string") return;
    // Two rows with one id in one file would leave the last silently winning, so the file is refused instead.
    if (given.findIndex((other) => idOf({ row: other }) === id) !== index) {
      issues.push(`--${field}[${String(index)}].${idKey}: "${id}" appears twice in the file`);
    }
    // Dropping and putting one id in one call asks for two things at once, so neither is guessed at.
    if (drops.includes(id)) {
      issues.push(`--${field}[${String(index)}].${idKey}: "${id}" is also dropped in this call`);
    }
  });
  const result: unknown[] = existing.filter((row) => !drops.some((drop) => idOf({ row }) === drop));
  for (const row of added) {
    const at = result.findIndex((kept) => idOf({ row: kept }) === row[idKey]);
    if (at === -1) {
      result.push(row);
    } else {
      result[at] = row;
    }
  }
  return result;
}

/**
 * The folds after one edit: the whole list replaced, or one index set (the length itself appends).
 *
 * @param form the form, read after any carry
 * @param folds the folds given
 * @param foldAt the one index to set, when given
 * @param issues where a bad index is named
 * @returns the new list
 */
function editedFolds({
  form,
  folds,
  foldAt,
  issues,
}: {
  form: Row;
  folds: readonly string[];
  foldAt: number | undefined;
  issues: string[];
}): readonly unknown[] {
  if (foldAt === undefined) {
    return folds;
  }
  const existing = rowsOf({ field: "folds", form, issues });
  if (folds.length !== 1) {
    issues.push(`--fold-at ${String(foldAt)}: sets ONE fold, and ${String(folds.length)} were given`);
    return existing;
  }
  if (foldAt > existing.length) {
    issues.push(
      `--fold-at ${String(foldAt)}: the form holds ${String(existing.length)} fold(s), so the index is a gap`,
    );
    return existing;
  }
  const next = [...existing];
  next[foldAt] = folds[0]!;
  return next;
}

/** Each scalar edit, the form field it sets, and the value — absent edits filtered out by the caller. */
function scalarEdits({ edits }: { edits: TickFillEdits }): readonly (readonly [string, unknown])[] {
  const pairs: (readonly [string, unknown])[] = [
    ["foldSummary", edits.foldSummary],
    ["lede", edits.lede],
    ["alignmentSummary", edits.alignmentSummary],
    ["earlierSummary", edits.earlierSummary],
    ["alignmentDetails", edits.alignmentDetails],
    ["dropCards", edits.dropCards],
    ["sleeping", edits.sleeping],
    ["openPagesReviewed", edits.openPagesReviewed],
    ["shift", edits.shift],
  ];
  return pairs.filter(([, value]) => value !== undefined);
}

/** The {@link CARRIED_FIELDS} an earlier tick's form holds, each as the field and its value. */
function carriedEdits({
  carried,
}: {
  carried: Readonly<Record<string, unknown>> | undefined;
}): readonly (readonly [string, unknown])[] {
  if (carried === undefined) {
    return [];
  }
  return CARRIED_FIELDS.filter((field) => carried[field] !== undefined).map(
    (field) => [field, carried[field]] as const,
  );
}

/**
 * The actions and judgements lists after their added rows and drops, each only when the fill touches it.
 *
 * @param form the form, read after every earlier edit
 * @param issues where a bad row or an unknown drop is named
 * @returns each touched list as the field and its new value
 */
function rowListEdits({
  edits,
  form,
  issues,
}: {
  edits: TickFillEdits;
  form: Row;
  issues: string[];
}): readonly (readonly [string, unknown])[] {
  const lists = [
    {
      added: parsedRows({ issues, rows: edits.actions, schema: authoredActionSchema, source: "--actions" }),
      drops: edits.dropActions,
      field: "actions",
      given: edits.actions,
      idKey: "actionId",
    },
    {
      added: parsedRows({ issues, rows: edits.judgements, schema: authoredJudgementSchema, source: "--judgements" }),
      drops: edits.dropJudgements,
      field: "judgements",
      given: edits.judgements,
      idKey: "judgementId",
    },
  ];
  return lists
    .filter((list) => list.given.length > 0 || list.drops.length > 0)
    .map(
      (list) =>
        [list.field, upserted({ ...list, existing: rowsOf({ field: list.field, form, issues }), issues })] as const,
    );
}

/**
 * Apply one fill to a tick file's parsed contents. Nothing is kept unless every added row parses and every drop
 * names a row that is there, so a refusal leaves the file exactly as it was.
 *
 * @param form the tick file as parsed JSON
 * @param edits what to change
 * @returns the new form and the fields it changed, or every issue naming its path
 */
export function applyTickFill({
  form,
  edits,
}: {
  form: unknown;
  edits: TickFillEdits;
}): Result<TickFillResult, TickWorkflowError> {
  if (!isRecord(form)) {
    return err(TickWorkflowErrors.inputInvalid({ issues: ["(the file): is not a JSON object"] }));
  }
  const issues: string[] = [];
  const next: Record<string, unknown> = { ...form };
  const changed: string[] = [];
  const set = ({ field, value }: { field: string; value: unknown }): void => {
    next[field] = value;
    if (!changed.includes(field)) changed.push(field);
  };
  for (const [field, value] of carriedEdits({ carried: edits.carried })) set({ field, value });
  if (edits.headline !== undefined) set({ field: "headline", value: { sentences: edits.headline } });
  if (edits.folds !== undefined) {
    set({ field: "folds", value: editedFolds({ foldAt: edits.foldAt, folds: edits.folds, form: next, issues }) });
  }
  for (const [field, value] of scalarEdits({ edits })) set({ field, value });
  for (const [field, value] of rowListEdits({ edits, form: next, issues })) set({ field, value });
  if (issues.length > 0) {
    return err(TickWorkflowErrors.inputInvalid({ issues }));
  }
  return ok({ changed, form: next });
}

/**
 * What `tick close` would still refuse in a form: the close's own parser, then — once that passes — the fleet-word
 * check close applies to the folds' wording, which can be stricter than close (`./tickFoldWording.ts`).
 *
 * @param form the form as it now stands
 * @returns every issue naming its field, none when close will take it
 */
export function tickFormIssues({ form }: { form: unknown }): readonly string[] {
  // The instant is only stamped on rows a close keeps; a readiness check keeps nothing, so any valid one serves.
  const parsed = parseTickInput({ recordedIso: "1970-01-01T00:00:00.000Z", value: form });
  if (parsed.isOk()) {
    const { folds, foldSummary, headline } = parsed.value;
    return foldWordingIssues({ recent: { foldSummary, folds, sentences: headline } });
  }
  const error = parsed.error;
  return error.code === "TICK_INPUT_INVALID" ? error.issues : [error.message];
}
