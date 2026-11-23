/**
 * The ruling register — `$SLOPWEAVER_HOME/rulings.jsonl`: the owner's standing rulings, one per line, each filed under
 * a category, carrying the owner's words exactly as given, where they were said, when they were decided, and which
 * earlier rulings they replaced.
 *
 * ## Append-only, and current is derived
 *
 * A row is never rewritten. A ruling is CURRENT exactly when no later row names its id in `replaces`, so a change of
 * the owner's mind is one new row and the old words survive under it. A row may only replace a ruling that was
 * current when it was written, so every ruling is replaced at most once and the chains are trees.
 *
 * ## Categories live in the rows
 *
 * Which categories exist is this install's business, so there is no list of them in code: a category is any kebab
 * slug a row already uses, and a new one has to be asked for by name (`--new-category`), so a misspelling never
 * silently opens a second category beside the first.
 *
 * ## Conflict is surfaced, never judged
 *
 * No model runs here (AGENTS.md rule 2). What the register can do is refuse to file a new ruling while a current one
 * in the same category stands beside it undisposed: the recording session reads the earlier words beside the new
 * ones and says, per earlier ruling, whether the new one replaces it or stands alongside it. Same-category rulings
 * are conflict CANDIDATES — a wrong category hides a real conflict, and that limit is stated rather than solved.
 *
 * This is the install-wide register. A board row's own ruling (`handover rule`) stays on the row's journal: it is
 * the owner's word about that one row, and becomes precedent here only when a session records it here deliberately.
 */
import { z } from "zod";

import { parseYyyyMmDdUtcMs } from "#lib/date.js";
import { parseJsonLine } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";
import { type RulingError, RulingErrors } from "./errors.js";

/** A category: lowercase letters and digits, joined by single hyphens. */
export const RULING_CATEGORY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** A ruling id: `ruling-` and twelve hex digits. */
export const RULING_ID = /^ruling-[0-9a-f]{12}$/u;

/**
 * Whether a string is a real `YYYY-MM-DD` calendar day. `Date.parse` alone rolls a day past the end of its month over
 * into the next one, so the day must also read back unchanged.
 */
function isCalendarDay({ value }: { value: string }): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const ms = parseYyyyMmDdUtcMs({ date: value });
  return ms !== undefined && new Date(ms).toISOString().slice(0, 10) === value;
}

/** Where a row came from: recorded by a session, or seeded from a supervisor state document's RULINGS section. */
type RulingOrigin =
  | { readonly kind: "record" }
  | { readonly kind: "seed"; readonly seedKey: string; readonly file: string; readonly line: number };

/** One ruling, as the register holds it. */
export interface RulingRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly category: string;
  /** The owner's words, exactly as given: never trimmed, reflowed or reworded. */
  readonly words: string;
  /** Where the words were said (a talk, call or transcript pointer), when known. */
  readonly anchor?: string;
  /** What the source said about the occasion beside the anchor (`on page …, call two`), when it said anything. */
  readonly context?: string;
  /** The day the owner decided it, `YYYY-MM-DD`. */
  readonly decidedOn: string;
  /** When this row was written. */
  readonly recordedIso: string;
  /** The ids of the rulings this one replaced. */
  readonly replaces: readonly string[];
  readonly origin: RulingOrigin;
}

const ORIGIN_SCHEMA = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("record") }).strict(),
  z
    .object({
      file: z.string().min(1),
      kind: z.literal("seed"),
      line: z.number().int().positive(),
      seedKey: z.string().regex(/^seed-v1:[0-9a-f]{64}$/u),
    })
    .strict(),
]);

const ROW_SCHEMA = z
  .object({
    anchor: z.string().min(1).optional(),
    category: z.string().regex(RULING_CATEGORY),
    context: z.string().min(1).optional(),
    decidedOn: z.string().refine((value) => isCalendarDay({ value }), { message: "not a calendar date" }),
    id: z.string().regex(RULING_ID),
    origin: ORIGIN_SCHEMA,
    recordedIso: z.iso.datetime(),
    replaces: z.array(z.string().regex(RULING_ID)),
    schemaVersion: z.literal(1),
    words: z.string().refine((value) => value.trim().length > 0, { message: "words are empty" }),
  })
  .strict();

/**
 * Parse one register line.
 *
 * @param line the line's text
 * @param lineNumber its 1-based position, named in an error
 * @param file the register's path, named in an error
 * @returns the row, or why the line is not one
 */
export function parseRulingLine({
  line,
  lineNumber,
  file,
}: {
  line: string;
  lineNumber: number;
  file: string;
}): Result<RulingRecord, RulingError> {
  const json = parseJsonLine({ line });
  if (json.isErr()) {
    return err(RulingErrors.malformed({ file, line: lineNumber, why: json.error.message }));
  }
  const parsed = ROW_SCHEMA.safeParse(json.value);
  if (!parsed.success) {
    const why = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    return err(RulingErrors.malformed({ file, line: lineNumber, why }));
  }
  const { anchor, context, ...required } = parsed.data;
  return ok({
    ...required,
    ...(anchor === undefined ? {} : { anchor }),
    ...(context === undefined ? {} : { context }),
  });
}

/**
 * One row as the register writes it: one JSON line, keys in a fixed order so a diff of the file reads as the change.
 *
 * @param record the row to write
 * @returns its line, with no terminator
 */
export function renderRulingLine({ record }: { record: RulingRecord }): string {
  return JSON.stringify({
    schemaVersion: record.schemaVersion,
    id: record.id,
    category: record.category,
    decidedOn: record.decidedOn,
    ...(record.anchor === undefined ? {} : { anchor: record.anchor }),
    ...(record.context === undefined ? {} : { context: record.context }),
    words: record.words,
    replaces: record.replaces,
    recordedIso: record.recordedIso,
    origin: record.origin,
  });
}

/** The register read whole: every row in file order, which ruling replaced which, and the current ones. */
export interface RulingProjection {
  readonly rows: readonly RulingRecord[];
  /** Each replaced ruling's id, mapped to the id of the ruling that replaced it. */
  readonly replacedBy: ReadonlyMap<string, string>;
  /** The rulings nothing has replaced, in file order. */
  readonly current: readonly RulingRecord[];
  /** Every category a row uses, sorted. */
  readonly categories: readonly string[];
}

/** Why one row contradicts the rows before it, or nothing when it does not. */
function contradictionOf({
  row,
  seen,
  seedKeys,
  replacedBy,
}: {
  row: RulingRecord;
  seen: ReadonlySet<string>;
  seedKeys: ReadonlySet<string>;
  replacedBy: ReadonlyMap<string, string>;
}): string | undefined {
  if (seen.has(row.id)) {
    return `id ${row.id} appears twice`;
  }
  if (row.origin.kind === "seed" && seedKeys.has(row.origin.seedKey)) {
    return `seed key ${row.origin.seedKey} appears twice`;
  }
  if (new Set(row.replaces).size !== row.replaces.length) {
    return "replaces names one id twice";
  }
  const unknown = row.replaces.find((replaced) => !seen.has(replaced));
  if (unknown !== undefined) {
    return `replaces ${unknown}, which no earlier row holds`;
  }
  const spent = row.replaces.find((replaced) => replacedBy.has(replaced));
  return spent === undefined ? undefined : `replaces ${spent}, which was already replaced`;
}

/**
 * Check the rows against each other and derive what is current.
 *
 * @param rows every row in file order
 * @param file the register's path, named in an error
 * @returns the projection, or the first row that contradicts the ones before it
 */
export function projectRulings({
  rows,
  file,
}: {
  rows: readonly RulingRecord[];
  file: string;
}): Result<RulingProjection, RulingError> {
  const seen = new Set<string>();
  const seedKeys = new Set<string>();
  const replacedBy = new Map<string, string>();
  for (const [index, row] of rows.entries()) {
    const why = contradictionOf({ replacedBy, row, seedKeys, seen });
    if (why !== undefined) {
      return err(RulingErrors.malformed({ file, line: index + 1, why }));
    }
    for (const replaced of row.replaces) {
      replacedBy.set(replaced, row.id);
    }
    seen.add(row.id);
    if (row.origin.kind === "seed") {
      seedKeys.add(row.origin.seedKey);
    }
  }
  return ok({
    categories: [...new Set(rows.map((row) => row.category))].toSorted(),
    current: rows.filter((row) => !replacedBy.has(row.id)),
    replacedBy,
    rows,
  });
}

/** What a caller asks to file. */
export interface RulingRecordInput {
  readonly id: string;
  readonly category: string;
  readonly words: string;
  readonly anchor?: string;
  readonly context?: string;
  readonly decidedOn: string;
  readonly recordedIso: string;
  readonly replaces: readonly string[];
  readonly origin: RulingOrigin;
  /** The caller asked for a category no row uses yet. */
  readonly newCategory: boolean;
  /** The caller read every other current ruling in the category and says the new one stands beside them. */
  readonly alongside: boolean;
}

/** A ruling cleared to file, and the current rulings in its category it was read beside. */
export interface RulingRecordPlan {
  readonly record: RulingRecord;
  readonly beside: readonly RulingRecord[];
}

/**
 * Decide whether one ruling may be filed against the register as it stands, before anything is written.
 *
 * @param projection the register as read
 * @param input what the caller asks to file
 * @returns the row to append and what it was read beside, or why it may not be filed yet
 */
export function planRulingRecord({
  projection,
  input,
}: {
  projection: RulingProjection;
  input: RulingRecordInput;
}): Result<RulingRecordPlan, RulingError> {
  if (!RULING_CATEGORY.test(input.category)) {
    return err(RulingErrors.categoryInvalid({ category: input.category }));
  }
  const exists = projection.categories.includes(input.category);
  if (!exists && !input.newCategory) {
    return err(RulingErrors.categoryUnknown({ category: input.category, known: projection.categories }));
  }
  if (exists && input.newCategory) {
    return err(RulingErrors.categoryExists({ category: input.category }));
  }
  if (!isCalendarDay({ value: input.decidedOn })) {
    return err(RulingErrors.dateInvalid({ value: input.decidedOn }));
  }
  if (input.words.trim().length === 0) {
    return err(RulingErrors.wordsEmpty());
  }
  const currentIds = new Set(projection.current.map((row) => row.id));
  const stale = input.replaces.find((id) => !currentIds.has(id));
  if (stale !== undefined) {
    return err(RulingErrors.replacesNotCurrent({ id: stale }));
  }
  const beside = projection.current.filter((row) => row.category === input.category);
  const undisposed = beside.filter((row) => !input.replaces.includes(row.id)).map((row) => row.id);
  if (undisposed.length > 0 && !input.alongside) {
    return err(RulingErrors.undisposed({ category: input.category, undisposed }));
  }
  const record: RulingRecord = {
    schemaVersion: 1,
    id: input.id,
    category: input.category,
    words: input.words,
    ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
    ...(input.context === undefined ? {} : { context: input.context }),
    decidedOn: input.decidedOn,
    recordedIso: input.recordedIso,
    replaces: [...new Set(input.replaces)],
    origin: input.origin,
  };
  return ok({ beside, record });
}

/**
 * The projection after appending rows a plan cleared — so a batch is planned one row at a time against the register
 * as it will stand, not as it stood before the batch.
 *
 * @param projection the register before
 * @param record the row being added
 * @returns the register after
 */
export function withRuling({
  projection,
  record,
}: {
  projection: RulingProjection;
  record: RulingRecord;
}): RulingProjection {
  const replacedBy = new Map(projection.replacedBy);
  for (const replaced of record.replaces) {
    replacedBy.set(replaced, record.id);
  }
  const rows = [...projection.rows, record];
  return {
    categories: [...new Set([...projection.categories, record.category])].toSorted(),
    current: rows.filter((row) => !replacedBy.has(row.id)),
    replacedBy,
    rows,
  };
}
