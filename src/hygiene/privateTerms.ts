/**
 * The private terms every outbound write is checked for: the installation's own private words, held at
 * `$SLOPWEAVER_HOME/hygiene/private-terms.tsv`, owner-only and never committed. The outbound privacy check
 * (`../outbound/privacyCheck.ts`) matches them; this module parses and loads them, and `./privateTermMatches.ts`
 * finds where they match a text.
 *
 * Format: blank lines and `#` comments are skipped; the first other line is one of two exact headers, and every
 * later line is one row of that header's cells:
 *
 * - `class<TAB>flags<TAB>pattern<TAB>source` — four cells, the first format. A row carries no meaning, so a match
 *   of it refuses outright, exactly as before the review existed.
 * - `id<TAB>class<TAB>flags<TAB>pattern<TAB>meaning<TAB>allowed-where<TAB>source` — seven cells. `id` is a random
 *   `pt-` name the verb minted, `meaning` what the owner said the term is, `allowed-where` where the owner said it is fine
 *   (empty for nowhere). A match of a row with a meaning HOLDS the write for a review of it in context
 *   (`../outbound/privateTermReview/gate.ts`); a row whose meaning is empty refuses outright, like a four-cell one.
 *   `slopweaver private-terms` writes this format; nobody edits it by hand.
 *
 * The class is one of a closed set ({@link PRIVATE_TERM_CLASSES}), the flags `i` (case-insensitive) or `-`, the
 * pattern a JavaScript regular expression that must compile and must not match the empty string. The source is free
 * text that is never matched and never printed: it is dropped at parse time, so nothing downstream can echo it. The
 * meaning and allowed-where cells are kept, but only for the review packet, which stays under the owner-only state
 * home; no finding, refusal or listing carries them.
 *
 * Each row is named by {@link PrivateTerm.termId}, which is safe to print: a seven-cell row's random id, or
 * `line-<n>` for a four-cell row, whose first edit gives every row an id. It is never derived from the row's bytes,
 * because a digest of a short row is guessable by hashing a list of names. {@link PrivateTerm.rowDigest} is that
 * digest, kept only where nothing prints it, so a release bound to it fails when the row is edited.
 *
 * ## Fail-closed, unlike the denylist
 *
 * The denylist is optional, so an absent one is normal. This file is not: ABSENT, UNREADABLE, readable by anyone
 * but its owner, a missing header or any malformed row refuses every write the check guards, and the refusal
 * names the file, the line and the class, never the pattern. A header with no row is the explicit "none" and
 * passes. Nothing seeds it, on purpose: a seeded header would make a fresh installation claim "none" unasked.
 * The one reader that passes an ABSENT file is the repository scan (`./repoScan.ts`), because no CI runner has one;
 * it says the terms were not applied, and fails on an unreadable or malformed file like every write.
 *
 * ## What it cannot protect against
 *
 * An owner-authored pattern runs in-process with no timeout, so a catastrophically backtracking one would stall
 * the write that matches it. That is a trusted local configuration's risk, stated rather than solved here; the
 * `redos-check` gate reads only source literals and cannot see these.
 */
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import {
  type PrivateTermsParseError,
  PrivateTermsParseErrors,
  type PrivateTermsRowMalformedError,
} from "./privateTermsErrors.js";
import { loadTextFileResult } from "./scan.js";

/** Every class a private term may be filed under. Closed: a class name is committed, so it must say nothing private. */
export const PRIVATE_TERM_CLASSES = [
  "owner-name",
  "owner-handle",
  "owner-address",
  "person",
  "organisation",
  "place",
  "health",
  "money",
  "topic",
] as const;

/** One class from {@link PRIVATE_TERM_CLASSES}. */
export type PrivateTermClass = (typeof PRIVATE_TERM_CLASSES)[number];

/**
 * The fixed wording a private-term finding prints after its locus and line. It lives beside the parser because
 * the parser refuses a pattern this wording could reproduce, so the two cannot drift apart. It names the route out
 * of a false positive as well as a real one, so a seat refused on harmless text knows to ask rather than reword.
 *
 * @returns the sentence naming the class and the route out, never the matched text
 */
export function privateTermFindingSentence({ className }: { className: PrivateTermClass }): string {
  return (
    `a private ${className} term (redacted here) — remove or generalise it, or if it is not private ask the ` +
    "chair to narrow that terms row"
  );
}

/**
 * What a refusal prints in place of any line a private term matches — its locus, a surface label, a field path or
 * its fixed wording. The parser refuses a pattern that matches this line, so the stand-in itself can never echo one.
 */
export const WITHHELD_REFUSAL_LINE =
  "a refusal line withheld here because a private term matches its wording — if the term is not private, ask the " +
  "chair to narrow that terms row";

/**
 * One private term: the class it reports under, its compiled, global expression, and what the owner said it means.
 * Its source is not kept.
 */
export interface PrivateTerm {
  /** The row's printable name: its `pt-` id cell, or `line-<n>` for a four-cell row. Never derived from its bytes. */
  readonly termId: string;
  /** sha256 of the row's exact bytes and its schema: never printed, and different for any edited row. */
  readonly rowDigest: string;
  readonly className: PrivateTermClass;
  readonly re: RegExp;
  /** What the owner said the term is; undefined for a four-cell row or an empty cell, which refuses outright. */
  readonly meaning: string | undefined;
  /** Where the owner said the term is fine; undefined when the owner named nowhere. */
  readonly allowedWhere: string | undefined;
}

/** Which header a file opened with: four cells, or seven with an id, a meaning and an allowed-where. */
export type PrivateTermsSchema = 1 | 2;

/** The four-cell header: no id and no meaning on any row. */
export const PRIVATE_TERMS_HEADER_V1 = "class\tflags\tpattern\tsource";

/** The seven-cell header the `private-terms` verbs write. */
export const PRIVATE_TERMS_HEADER_V2 = "id\tclass\tflags\tpattern\tmeaning\tallowed-where\tsource";

/** A seven-cell row's id: `pt-` and twelve lowercase hex digits, minted at random by the verb. */
export const PRIVATE_TERM_ID = /^pt-[0-9a-f]{12}$/u;

/**
 * Pure: the digest one row is bound by, from its exact bytes and the header it sits under. Never printed.
 *
 * @internal
 * @param schema the header the row sits under
 * @param raw the row's exact text
 * @returns sixty-four hex digits
 */
export function privateTermRowDigest({ schema, raw }: { schema: PrivateTermsSchema; raw: string }): string {
  return createHash("sha256")
    .update(`private-term-row/v${String(schema)}\n${raw}`)
    .digest("hex");
}

/** How many cells a row of each schema carries. */
const CELLS_PER_ROW: Readonly<Record<PrivateTermsSchema, number>> = { 1: 4, 2: 7 };

/** A row's cells by name, whichever schema it was written under: a four-cell row has no id, meaning or allowed-where. */
interface RowCells {
  readonly id: string | undefined;
  readonly classCell: string;
  readonly flags: string;
  readonly pattern: string;
  readonly meaning: string;
  readonly allowedWhere: string;
}

/** Name a row's cells; the count was already checked against the schema. */
function rowCells({ cells, schema }: { cells: readonly string[]; schema: PrivateTermsSchema }): RowCells {
  if (schema === 1) {
    return { allowedWhere: "", classCell: cells[0]!, flags: cells[1]!, id: undefined, meaning: "", pattern: cells[2]! };
  }
  return {
    allowedWhere: cells[5]!,
    classCell: cells[1]!,
    flags: cells[2]!,
    id: cells[0]!,
    meaning: cells[4]!,
    pattern: cells[3]!,
  };
}

/** A free-text cell as a term carries it: undefined when it says nothing. */
function optionalCell({ cell }: { cell: string }): string | undefined {
  if (cell.trim() === "") {
    return undefined;
  }
  return cell;
}

/** Whether a class cell is one of the closed set. */
function isPrivateTermClass(cell: string | undefined): cell is PrivateTermClass {
  return PRIVATE_TERM_CLASSES.some((known) => known === cell);
}

/** How a class cell is named in an error: itself only when it is a known class, since an unknown cell may be a term. */
function printableClass({ cell }: { cell: string | undefined }): string {
  if (isPrivateTermClass(cell)) {
    return cell;
  }
  return "<unknown, not printed>";
}

/**
 * Pure: one row. An error names the line and the class, never the pattern or the source.
 *
 * @param line the one-based physical line it sits on
 * @param raw the line's text
 * @param schema the header the file opened with, which fixes the cell count
 * @returns the compiled term, or why the row is malformed
 */
function parseRow({
  line,
  raw,
  schema,
}: {
  line: number;
  raw: string;
  schema: PrivateTermsSchema;
}): Result<PrivateTerm, PrivateTermsRowMalformedError> {
  const cells = raw.split("\t");
  const className = printableClass({ cell: cells[schema === 1 ? 0 : 1] });
  const expected = CELLS_PER_ROW[schema];
  if (cells.length !== expected) {
    return err(
      PrivateTermsParseErrors.rowMalformed({
        className,
        line,
        why: `expected ${String(expected)} tab-separated cells, got ${String(cells.length)}`,
      }),
    );
  }
  const { allowedWhere, classCell, flags, id, meaning, pattern } = rowCells({ cells, schema });
  const compiled = compiledRow({ classCell, flags, id, pattern });
  if (typeof compiled === "string") {
    return err(PrivateTermsParseErrors.rowMalformed({ className, line, why: compiled }));
  }
  let termId = `line-${String(line)}`; // a version-1 row carries no id, so it is named by its line
  if (id !== undefined) {
    termId = id;
  }
  return ok({
    allowedWhere: optionalCell({ cell: allowedWhere }),
    className: compiled.className,
    meaning: optionalCell({ cell: meaning }),
    re: compiled.re,
    rowDigest: privateTermRowDigest({ raw, schema }),
    termId,
  });
}

/**
 * A row's id, class, flags and pattern checked and compiled, or the reason one of them cannot stand: the only text
 * a refusal adds to the line and class it already names.
 */
function compiledRow({
  classCell,
  flags,
  id,
  pattern,
}: {
  classCell: string;
  flags: string;
  id: string | undefined;
  pattern: string;
}): { readonly className: PrivateTermClass; readonly re: RegExp } | string {
  if (id !== undefined && !PRIVATE_TERM_ID.test(id)) {
    return "the id must be pt- and twelve lowercase hex digits";
  }
  if (!isPrivateTermClass(classCell)) {
    return `the class must be one of ${PRIVATE_TERM_CLASSES.join(", ")}`;
  }
  if (flags !== "i" && flags !== "-") {
    return "flags must be 'i' or '-'";
  }
  if (pattern.length === 0) {
    return "the pattern is empty";
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags === "i" ? "gi" : "g");
  } catch {
    return "the pattern is not a valid regular expression";
  }
  const problem = compiledPatternProblem({ re });
  if (problem !== undefined) {
    return problem;
  }
  return { className: classCell, re };
}

/**
 * Pure: why a compiled pattern cannot be a private term, judged on what it would match rather than how it is spelled.
 *
 * @param re the row's compiled, global expression; left ready to match from the start
 * @returns the reason it is refused, or undefined when it may stand
 */
function compiledPatternProblem({ re }: { re: RegExp }): string | undefined {
  if (re.test("")) {
    return "the pattern matches the empty string, so it matches everywhere";
  }
  // Every finding prints its fixed wording and class, so a pattern matching any part of it, a class name or a span
  // such as "private person" included, would put the matched text in the finding itself. A line the terms match is
  // printed as the withheld stand-in, so that stand-in must be matched by none either.
  const printedWordings = [
    ...PRIVATE_TERM_CLASSES.map((name) => privateTermFindingSentence({ className: name })),
    WITHHELD_REFUSAL_LINE,
  ];
  const matchesFindingWording = printedWordings.some((wording) => {
    re.lastIndex = 0;
    return re.test(wording);
  });
  re.lastIndex = 0;
  if (matchesFindingWording) {
    return "the pattern matches the wording every finding prints, a class name or the withheld-line stand-in included";
  }
  return undefined;
}

/**
 * Pure: which schema a header line opens, or undefined when it is neither.
 *
 * @param header the first non-comment line, exactly
 * @returns 1 for the four-cell header, 2 for the seven-cell one
 */
export function privateTermsSchemaOf({ header }: { header: string }): PrivateTermsSchema | undefined {
  if (header === PRIVATE_TERMS_HEADER_V1) {
    return 1;
  }
  if (header === PRIVATE_TERMS_HEADER_V2) {
    return 2;
  }
  return undefined;
}

/**
 * Pure: parse the private-terms file. A header with no row is the explicit "none" and parses to `[]`.
 *
 * @param text the whole file
 * @returns every term compiled in file order, or the first reason the file cannot be trusted
 */
export function parsePrivateTerms({ text }: { text: string }): Result<readonly PrivateTerm[], PrivateTermsParseError> {
  const [header, ...body] = text
    .split(/\r?\n/)
    .map((raw, index) => ({ line: index + 1, raw }))
    .filter(({ raw }) => raw.trim().length > 0 && !raw.startsWith("#"));
  if (header === undefined) {
    return err(PrivateTermsParseErrors.headerMissing({ line: 1 }));
  }
  const schema = privateTermsSchemaOf({ header: header.raw });
  if (schema === undefined) {
    return err(PrivateTermsParseErrors.headerMissing({ line: header.line }));
  }
  const terms: PrivateTerm[] = [];
  for (const { line, raw } of body) {
    const term = parseRow({ line, raw, schema });
    if (term.isErr()) {
      return err(term.error);
    }
    if (terms.some((earlier) => earlier.termId === term.value.termId)) {
      return err(
        PrivateTermsParseErrors.rowMalformed({
          className: term.value.className,
          line,
          why: `the id ${term.value.termId} is already on an earlier row`,
        }),
      );
    }
    terms.push(term.value);
  }
  return ok(terms);
}

/** The outcome of loading the private-terms file. Every kind but `loaded` refuses every guarded write. */
export type PrivateTermsLoad =
  | { readonly kind: "loaded"; readonly path: string; readonly terms: readonly PrivateTerm[] }
  | { readonly kind: "absent"; readonly path: string }
  | { readonly kind: "unreadable"; readonly path: string; readonly reason: string }
  | { readonly kind: "invalid"; readonly path: string; readonly error: PrivateTermsParseError };

/**
 * Read and parse the private-terms file under one home. A file group or others can read is `unreadable`: the
 * terms are the owner's own, and the check refuses to rely on a copy it cannot say is private.
 *
 * @param home the state home the file lives under; required, so no caller reads the ambient home by accident
 * @param readText the reader (injected so the unreadable branch is testable without chmod)
 * @param nameExists whether any entry, a dangling link included, sits at the path — asked only on `ENOENT`
 * @param fileMode the file's mode bits, asked only after a successful read
 * @returns the load outcome
 */
export function loadPrivateTerms({
  home,
  readText,
  nameExists,
  fileMode = ({ path }) => statSync(path).mode,
}: {
  home: string;
  readText?: (args: { path: string }) => string;
  nameExists?: (args: { path: string }) => boolean;
  fileMode?: (args: { path: string }) => number;
}): PrivateTermsLoad {
  const path = stateHomePaths({ home }).privateTerms;
  const loaded = loadTextFileResult({
    path,
    ...(readText === undefined ? {} : { readText }),
    ...(nameExists === undefined ? {} : { nameExists }),
  });
  if (loaded.kind === "absent") {
    return { kind: "absent", path };
  }
  if (loaded.kind === "unreadable") {
    return loaded;
  }
  const mode = fileMode({ path }) & 0o777;
  if ((mode & 0o077) !== 0) {
    return { kind: "unreadable", path, reason: `mode ${mode.toString(8)} lets others read it; chmod 600 it` };
  }
  const parsed = parsePrivateTerms({ text: loaded.text });
  if (parsed.isErr()) {
    return { error: parsed.error, kind: "invalid", path };
  }
  return { kind: "loaded", path, terms: parsed.value };
}

/**
 * The one sentence a guarded write refuses with when the terms did not load. Names the file, the line and the
 * class where there is one, never a pattern or a source.
 *
 * @param load the failed load
 * @returns the refusal, ending in its remedy
 */
export function privateTermsRefusal({ load }: { load: Exclude<PrivateTermsLoad, { kind: "loaded" }> }): string {
  if (load.kind === "absent") {
    return (
      `hygiene: the private terms file ${load.path} does not exist, so no outbound write is checked for them. ` +
      "Add a term with `slopweaver private-terms add`, or create it mode 0600 holding only the header line " +
      "id<TAB>class<TAB>flags<TAB>pattern<TAB>meaning<TAB>allowed-where<TAB>source, which says there are none."
    );
  }
  if (load.kind === "unreadable") {
    return `hygiene: the private terms file ${load.path} could not be relied on (${load.reason}).`;
  }
  return `hygiene: the private terms file ${load.path} is malformed at ${load.error.message}.`;
}

/**
 * The private terms under one home, or the refusal sentence a guarded write prints instead of sending.
 *
 * @param home the state home the file lives under
 * @returns the loaded terms, or the refusal
 */
export function privateTermsOrRefusal({ home }: { home: string }): Result<readonly PrivateTerm[], string> {
  const load = loadPrivateTerms({ home });
  return load.kind === "loaded" ? ok(load.terms) : err(privateTermsRefusal({ load }));
}

/**
 * Pure: the one status line saying whether the private terms applied, and how many.
 *
 * @param load the load outcome
 * @returns the line, without a trailing newline
 */
export function privateTermsStatusLine({ load }: { load: PrivateTermsLoad }): string {
  if (load.kind === "absent") {
    return `hygiene: private terms NOT PRESENT at ${load.path} — every guarded write refuses`;
  }
  if (load.kind === "unreadable") {
    return `hygiene: private terms UNREADABLE at ${load.path} (${load.reason}) — every guarded write refuses`;
  }
  if (load.kind === "invalid") {
    return `hygiene: private terms UNREADABLE at ${load.path} (malformed at ${load.error.message}) — every guarded write refuses`;
  }
  if (load.terms.length === 0) {
    return "hygiene: private terms EMPTY — the file says there are none";
  }
  return `hygiene: private terms LOADED ${String(load.terms.length)}`;
}

/**
 * Pure: one refusal line as it may be printed. A line any private term matches — its locus, a surface label or a
 * field path as much as its wording — is replaced whole by {@link WITHHELD_REFUSAL_LINE}, which the parser
 * guarantees no term matches, so a refusal can never echo a private term whatever the line was built from.
 *
 * @param line one line a refusal is about to print
 * @param terms the loaded terms
 * @returns the line, or the withheld stand-in
 */
export function printableUnderTerms({ line, terms }: { line: string; terms: readonly PrivateTerm[] }): string {
  const matched = terms.some(({ re }) => {
    re.lastIndex = 0;
    const hit = re.test(line);
    re.lastIndex = 0;
    return hit;
  });
  if (matched) {
    return WITHHELD_REFUSAL_LINE;
  }
  return line;
}
