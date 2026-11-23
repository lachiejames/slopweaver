/**
 * THE HANDS-FREE LIST, pure half: one edit of the private-terms file (`./privateTerms.ts`) as text in, text out.
 *
 * The owner says or types a rule to the supervisor and never edits the file, so `slopweaver private-terms add`,
 * `narrow` and `remove` write it. Each edit is decided here over the file's exact text and re-parsed WHOLE before
 * anything is written: an edit leaving the file malformed is refused, and nothing changes.
 *
 * ## A four-cell file is migrated on its first edit
 *
 * The first edit of a four-cell file rewrites its header to the seven-cell one and gives every row a fresh random id,
 * an empty meaning and an empty allowed-where, keeping each row's class, flags, pattern and source byte for byte, and
 * every comment and blank line where it was. A row with no meaning still refuses outright, so the migration changes
 * no verdict; it only lets a row be named and given a meaning. A four-cell row is named `line-<n>` before that, so an
 * edit naming one is resolved against the file before migration.
 *
 * ## What it never does
 *
 * It never prints, and nothing it returns carries a pattern or a source back out: a caller prints ids, classes and
 * counts. A meaning is returned only so the shell can judge whether printing it would echo a term.
 */
import { err, ok, type Result } from "../lib/result.js";
import {
  PRIVATE_TERM_CLASSES,
  PRIVATE_TERM_ID,
  PRIVATE_TERMS_HEADER_V2,
  type PrivateTerm,
  type PrivateTermClass,
  parsePrivateTerms,
  privateTermsSchemaOf,
} from "./privateTerms.js";

/** A new row, as the verb took it from the owner's words. */
export interface PrivateTermRowInput {
  readonly className: PrivateTermClass;
  readonly caseInsensitive: boolean;
  readonly pattern: string;
  readonly meaning: string;
  readonly allowedWhere: string;
  readonly source: string;
}

/**
 * The cells a narrowing replaces; a field left undefined keeps the row's own.
 *
 * @internal
 */
export interface PrivateTermNarrowing {
  readonly pattern: string | undefined;
  readonly caseInsensitive: boolean | undefined;
  readonly meaning: string | undefined;
  readonly allowedWhere: string | undefined;
}

/** One edit. */
export type PrivateTermsEdit =
  | { readonly kind: "add"; readonly row: PrivateTermRowInput }
  | { readonly kind: "narrow"; readonly termId: string; readonly narrowing: PrivateTermNarrowing }
  | { readonly kind: "remove"; readonly termId: string };

/** The file as it is now: its exact text, or absent. */
export type PrivateTermsCurrent = { readonly kind: "absent" } | { readonly kind: "present"; readonly text: string };

/** An edit, decided. */
export interface PrivateTermsEdited {
  readonly text: string;
  /** The row the edit added, changed or removed, by the id it carries in the new file (a removed row's old id). */
  readonly termId: string;
  /** Every term the new file parses to. */
  readonly terms: readonly PrivateTerm[];
  /** The edited row as the new file parses it; undefined for a removal. */
  readonly edited: PrivateTerm | undefined;
  /** How many rows the file held before and after. */
  readonly rowsBefore: number;
  readonly rowsAfter: number;
  /** Whether this edit migrated a four-cell file. */
  readonly migrated: boolean;
}

/** The file the edit starts from does not parse, so no edit of it can be judged. */
interface CurrentMalformedError {
  readonly code: "CURRENT_MALFORMED";
  readonly message: string;
}

/** A cell the owner's words gave cannot sit in the file. */
interface CellInvalidError {
  readonly code: "CELL_INVALID";
  readonly message: string;
}

/** No row carries the id the edit names. */
interface TermNotFoundError {
  readonly code: "TERM_NOT_FOUND";
  readonly message: string;
  readonly termId: string;
}

/** The edit would leave the file malformed, so it is refused and nothing is written. */
interface ResultMalformedError {
  readonly code: "RESULT_MALFORMED";
  readonly message: string;
}

/** A narrowing that names no cell to change. */
interface NothingToChangeError {
  readonly code: "NOTHING_TO_CHANGE";
  readonly message: string;
}

/** Every way an edit is refused. */
export type PrivateTermsEditError =
  CurrentMalformedError | CellInvalidError | TermNotFoundError | ResultMalformedError | NothingToChangeError;

/**
 * The factory every edit refusal is built through. Never carries a pattern, a source or a meaning.
 *
 * @internal
 */
export const PrivateTermsEditErrors = {
  cellInvalid: ({ cell, why }: { cell: string; why: string }): CellInvalidError => ({
    code: "CELL_INVALID",
    message: `the ${cell} cannot be written: ${why}`,
  }),
  currentMalformed: ({ detail }: { detail: string }): CurrentMalformedError => ({
    code: "CURRENT_MALFORMED",
    message: `the private terms file does not parse (${detail}), so no edit of it can be judged`,
  }),
  nothingToChange: (): NothingToChangeError => ({
    code: "NOTHING_TO_CHANGE",
    message: "name at least one of --pattern, --case, --meaning or --allowed-where to change",
  }),
  resultMalformed: ({ detail }: { detail: string }): ResultMalformedError => ({
    code: "RESULT_MALFORMED",
    message: `the edit would leave the file malformed at ${detail}; nothing was written`,
  }),
  termNotFound: ({ termId }: { termId: string }): TermNotFoundError => ({
    code: "TERM_NOT_FOUND",
    message: `no row of the private terms file is named ${printableTermName({ termId })}; \`slopweaver private-terms list\` names every row`,
    termId,
  }),
} as const;

/** A row name as a refusal prints it: itself only in an id's shape, since a mistaken argument may be a term. */
function printableTermName({ termId }: { termId: string }): string {
  if (PRIVATE_TERM_ID.test(termId) || /^line-[1-9][0-9]*$/u.test(termId)) {
    return termId;
  }
  return "<not a row id, not printed>";
}

/** One physical line of the file, and the parsed fields an edit reads off a row. */
interface FileLine {
  readonly raw: string;
  /** The row's id in the seven-cell file this line ends up in; undefined for a header, comment or blank line. */
  readonly id: string | undefined;
  /** The name an edit may call it by before migration: `line-<n>` for a four-cell row, else its id. */
  readonly alias: string | undefined;
}

/** Whether a line is a comment or blank, which the parser skips and the editor keeps where it was. */
function isSkipped({ raw }: { raw: string }): boolean {
  return raw.trim().length === 0 || raw.startsWith("#");
}

/** Refuse a cell holding what the format cannot: a tab or a line break. */
function checkCell({ cell, value }: { cell: string; value: string }): Result<string, PrivateTermsEditError> {
  if (/[\t\r\n]/u.test(value)) {
    return err(PrivateTermsEditErrors.cellInvalid({ cell, why: "it holds a tab or a line break" }));
  }
  return ok(value);
}

/**
 * Read the file into seven-cell lines, migrating a four-cell one.
 *
 * @param text the file's exact text
 * @param mintId a fresh random row id
 * @returns the lines with the header first, and whether a migration happened
 */
function toSevenCellLines({
  text,
  mintId,
}: {
  text: string;
  mintId: () => string;
}): Result<{ readonly lines: readonly FileLine[]; readonly migrated: boolean }, PrivateTermsEditError> {
  const parsed = parsePrivateTerms({ text });
  if (parsed.isErr()) {
    return err(PrivateTermsEditErrors.currentMalformed({ detail: parsed.error.message }));
  }
  const physical = text.split(/\r?\n/u);
  // A file ending in a line break splits into a trailing empty string, which is the break rather than a line.
  if (physical.at(-1) === "") {
    physical.pop();
  }
  const headerIndex = physical.findIndex((raw) => !isSkipped({ raw }));
  const schema = privateTermsSchemaOf({ header: physical[headerIndex]! });
  const lines: FileLine[] = [];
  physical.forEach((raw, index) => {
    if (index === headerIndex) {
      lines.push({ alias: undefined, id: undefined, raw: PRIVATE_TERMS_HEADER_V2 });
      return;
    }
    if (index < headerIndex || isSkipped({ raw })) {
      lines.push({ alias: undefined, id: undefined, raw });
      return;
    }
    if (schema === 2) {
      const id = raw.split("\t")[0]!;
      lines.push({ alias: id, id, raw });
      return;
    }
    const [classCell, flags, pattern, source] = raw.split("\t");
    const id = mintId();
    lines.push({
      alias: `line-${String(index + 1)}`,
      id,
      raw: [id, classCell!, flags!, pattern!, "", "", source!].join("\t"),
    });
  });
  return ok({ lines, migrated: schema === 1 });
}

/** The seven cells a row line carries. */
function cellsOf({ raw }: { raw: string }): readonly string[] {
  return raw.split("\t");
}

/** A fresh id no line already carries. */
function freshId({ lines, mintId }: { lines: readonly FileLine[]; mintId: () => string }): string {
  for (;;) {
    const id = mintId();
    if (PRIVATE_TERM_ID.test(id) && !lines.some((line) => line.id === id)) {
      return id;
    }
  }
}

/** The new row's line, or the cell that cannot be written. */
function addedLine({ row, id }: { row: PrivateTermRowInput; id: string }): Result<string, PrivateTermsEditError> {
  if (row.meaning.trim() === "") {
    return err(
      PrivateTermsEditErrors.cellInvalid({
        cell: "meaning",
        why: "it is empty, and a term lands with the meaning the owner described",
      }),
    );
  }
  return checkCell({ cell: "pattern", value: row.pattern })
    .andThen(() => checkCell({ cell: "meaning", value: row.meaning }))
    .andThen(() => checkCell({ cell: "allowed-where", value: row.allowedWhere }))
    .andThen(() => checkCell({ cell: "source", value: row.source }))
    .map(() =>
      [id, row.className, row.caseInsensitive ? "i" : "-", row.pattern, row.meaning, row.allowedWhere, row.source].join(
        "\t",
      ),
    );
}

/** A narrowed row's line, or the cell that cannot be written. */
function narrowedLine({
  raw,
  narrowing,
}: {
  raw: string;
  narrowing: PrivateTermNarrowing;
}): Result<string, PrivateTermsEditError> {
  const { allowedWhere, caseInsensitive, meaning, pattern } = narrowing;
  if (allowedWhere === undefined && caseInsensitive === undefined && meaning === undefined && pattern === undefined) {
    return err(PrivateTermsEditErrors.nothingToChange());
  }
  if (meaning?.trim() === "") {
    return err(PrivateTermsEditErrors.cellInvalid({ cell: "meaning", why: "it is empty; a row keeps its meaning" }));
  }
  const cells = [...cellsOf({ raw })];
  const replacements: readonly { readonly index: number; readonly cell: string; readonly value: string | undefined }[] =
    [
      { cell: "pattern", index: 3, value: pattern },
      { cell: "meaning", index: 4, value: meaning },
      { cell: "allowed-where", index: 5, value: allowedWhere },
    ];
  for (const { cell, index, value } of replacements) {
    if (value === undefined) {
      continue;
    }
    const checked = checkCell({ cell, value });
    if (checked.isErr()) {
      return err(checked.error);
    }
    cells[index] = value;
  }
  if (caseInsensitive !== undefined) {
    cells[2] = caseInsensitive ? "i" : "-";
  }
  return ok(cells.join("\t"));
}

/** The file's lines after one edit, and the id of the row it added, changed or removed. */
function nextLines({
  edit,
  lines,
  mintId,
}: {
  edit: PrivateTermsEdit;
  lines: readonly FileLine[];
  mintId: () => string;
}): Result<{ readonly next: readonly string[]; readonly termId: string }, PrivateTermsEditError> {
  if (edit.kind === "add") {
    const termId = freshId({ lines, mintId });
    return addedLine({ id: termId, row: edit.row }).map((line) => ({
      next: [...lines.map(({ raw }) => raw), line],
      termId,
    }));
  }
  const target = lines.find((line) => line.alias === edit.termId || line.id === edit.termId);
  if (target === undefined) {
    return err(PrivateTermsEditErrors.termNotFound({ termId: edit.termId }));
  }
  const termId = target.id!;
  if (edit.kind === "remove") {
    return ok({ next: lines.filter((line) => line !== target).map(({ raw }) => raw), termId });
  }
  return narrowedLine({ narrowing: edit.narrowing, raw: target.raw }).map((line) => ({
    next: lines.map((one) => (one === target ? line : one.raw)),
    termId,
  }));
}

/**
 * Pure: decide one edit of the private-terms file.
 *
 * @param current the file's exact text, or that it is absent (an add then starts the file)
 * @param edit what the owner asked for
 * @param mintId a fresh random `pt-` id; called once per row a migration or an add names
 * @returns the new text and what it changed, or why the edit is refused
 */
export function applyPrivateTermsEdit({
  current,
  edit,
  mintId,
}: {
  current: PrivateTermsCurrent;
  edit: PrivateTermsEdit;
  mintId: () => string;
}): Result<PrivateTermsEdited, PrivateTermsEditError> {
  if (current.kind === "absent" && edit.kind !== "add") {
    return err(PrivateTermsEditErrors.termNotFound({ termId: edit.termId }));
  }
  const text = current.kind === "absent" ? `${PRIVATE_TERMS_HEADER_V2}\n` : current.text;
  const read = toSevenCellLines({ mintId, text });
  if (read.isErr()) {
    return err(read.error);
  }
  const { lines, migrated } = read.value;
  const rowsBefore = lines.filter((line) => line.id !== undefined).length;
  const decided = nextLines({ edit, lines, mintId });
  if (decided.isErr()) {
    return err(decided.error);
  }
  const { next, termId } = decided.value;
  const nextText = `${next.join("\n")}\n`;
  const parsed = parsePrivateTerms({ text: nextText });
  if (parsed.isErr()) {
    return err(PrivateTermsEditErrors.resultMalformed({ detail: parsed.error.message }));
  }
  const terms = parsed.value;
  return ok({
    edited: terms.find((term) => term.termId === termId),
    migrated,
    rowsAfter: terms.length,
    rowsBefore,
    termId,
    terms,
    text: nextText,
  });
}

/**
 * Pure: read one class name from the owner's words, refusing anything outside the closed set.
 *
 * @param text the class the verb was given
 * @returns the class, or why it is not one
 */
export function privateTermClassOf({ text }: { text: string }): Result<PrivateTermClass, PrivateTermsEditError> {
  const known = PRIVATE_TERM_CLASSES.find((name) => name === text);
  if (known === undefined) {
    return err(
      PrivateTermsEditErrors.cellInvalid({
        cell: "class",
        why: `it must be one of ${PRIVATE_TERM_CLASSES.join(", ")}`,
      }),
    );
  }
  return ok(known);
}
