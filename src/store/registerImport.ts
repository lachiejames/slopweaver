/**
 * The one-time import a multi-row register makes from the home file it used to live in, and the connection
 * discipline every store-backed register port shares.
 *
 * The home moves into the store; the plan register set the
 * conventions this follows: the row is the authority, the old file is imported ONCE, a store outage is a typed
 * refusal and never a file fallback. A singleton can use its own row as the "already imported" marker. The press
 * register, the landing-read cursor and the Codex supersessions cannot, so they share `home_file_import`
 * (`./schema/homeFileImport.ts`), and this module is the protocol over it:
 *
 * 1. A marker for the register means the import happened: the file is never opened again. A marker that imported
 *    records over a table holding none is refused — the rows were lost, and an empty answer would hide it.
 * 2. No marker: the file is read and decoded STRICTLY, before anything is written. Absent is a legitimate
 *    answer; unreadable or malformed is a refusal, and nothing is written for it.
 * 3. One transaction inserts the marker `ON CONFLICT DO NOTHING`; only the transaction that won it inserts the
 *    file's rows, each `ON CONFLICT DO NOTHING` on the domain key. A loser writes nothing.
 * 4. Every caller then reads the TABLE — a loser never answers from the file it decoded.
 *
 * Decoding precedes the transaction on purpose: a Drizzle callback that returns rather than throws COMMITS, so a
 * refusal discovered inside one would leave a marker over no rows.
 *
 * Every register port runs the protocol on its first operation of a connection, read or write alike: a write
 * made before any read must not strand the file's history behind a table that is no longer empty.
 *
 * ## What this cannot do
 *
 * A seat still running code from before the move can append to the old file after the import snapshot. That
 * row is not captured, and the marker makes the file permanently ignored — the upgrade boundary, stated rather
 * than discovered. The same boundary covers a file written or changed while two first imports race: whichever
 * importer commits the marker fixes the snapshot, and the other answers from the store.
 *
 * Nor can it see the store edited by hand. No verb deletes a row from these tables, so the marker's count is
 * checked only against an EMPTY table: imported rows deleted out of band, with a later row beside them, read as
 * absent. Closing that needs every imported row tagged with its import, a column no consumer reads yet.
 *
 * A register whose one file writes SEVERAL tables, and whose rows are versions nothing deletes, uses
 * `importOnceRegisterOver` (`./registerImportRows.ts`, the Postgres half) instead: its probe counts exactly the
 * rows the import itself wrote, across those tables — the register tags each with its provenance, so a row a
 * later writer added never stands in for an imported one — and a count below the marker's is refused with both
 * numbers rather than read as fewer instructions.
 */
import { createHash } from "node:crypto";

import { isAbsentError, readStrictFileIfPresent } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";

import { readJsonlLines } from "../corpus/corpusStore.js";

/** The exact bytes an import read: their `sha256:` digest and their count. */
export interface ImportSourceWitness {
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * What a register's old home file held: nothing at all, or every record it decoded to, in file order — with the
 * file's witness on a register that records one (`./schema/homeFileImport.ts` § A witnessed register).
 */
export type ImportSource<T> =
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly records: readonly T[]; readonly witness?: ImportSourceWitness };

/** What a witnessed register's marker recorded of its file: none there, or the bytes it imported. */
export type MarkedSource =
  { readonly state: "absent" } | { readonly state: "present"; readonly witness: ImportSourceWitness | null };

/**
 * How the old path stands against what its import recorded: `retired` when nothing is there now, `unchanged` when
 * it holds exactly the witnessed bytes, and `changed` otherwise — a file that appeared after an import found none,
 * one that differs from what was imported, or a present marker that recorded no witness to compare against.
 *
 * @param marked what the marker recorded
 * @param current the path's bytes now, or `null` when nothing is there
 * @returns the verdict
 */
export function homeFileWitnessVerdict({
  marked,
  current,
}: {
  marked: MarkedSource;
  current: ImportSourceWitness | null;
}): "retired" | "unchanged" | "changed" {
  if (current === null) {
    return "retired";
  }
  if (marked.state === "absent" || marked.witness === null) {
    return "changed";
  }
  const same = marked.witness.sha256 === current.sha256 && marked.witness.bytes === current.bytes;
  return same ? "unchanged" : "changed";
}

/**
 * Why an old home file could not be imported, before any domain names it: it would not read, or a record in
 * it would not decode. Each register's port maps this into its own error union at the one place it reads.
 */
export type ImportFileProblem =
  | { readonly kind: "unreadable"; readonly path: string; readonly reason: string }
  | { readonly kind: "invalid"; readonly path: string; readonly problems: readonly string[] };

/** A store step that did not finish: what it was for, and what the driver said. */
export interface StoreStepFailure {
  /** Finishes "the store could not …". */
  readonly doing: string;
  readonly reason: string;
  /**
   * Set when the step that failed is trusting a marker that claims more records than the tables hold, so a
   * register can name that loss in its own terms rather than as an outage.
   */
  readonly markerInconsistency?: { readonly expected: number; readonly observed: number };
}

/** A marker that contradicts its tables: always a step failure that names both counts. */
export type MarkerStepFailure = StoreStepFailure & {
  readonly markerInconsistency: NonNullable<StoreStepFailure["markerInconsistency"]>;
};

/** A register's import marker as read back: how many records the import claimed, and whether its table holds any. */
export interface ImportMarker {
  readonly records: number;
  readonly tableHasRows: boolean;
  /**
   * How many of the rows the import wrote the register's tables still hold, when its marker probe COUNTS them
   * (`importOnceRegisterOver`). Nothing deletes an imported version, so a count below the marker is a loss the
   * single-table "any row" probe cannot see.
   */
  readonly observedRows?: number;
}

/** The two marker operations the protocol needs, over one open connection. */
export interface ImportOnceRows<T> {
  /** The register's marker, or undefined when no import has run. */
  readonly marker: () => Promise<Result<ImportMarker | undefined, StoreStepFailure>>;
  /** Claim the marker and, iff this call won it, insert the source's records — one transaction. */
  readonly claim: (request: { readonly source: ImportSource<T> }) => Promise<Result<boolean, StoreStepFailure>>;
}

/**
 * The message of whatever a step threw.
 *
 * @param cause what was thrown
 * @returns its message, or a fixed sentence for a non-Error throw
 */
function stepReason({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return "unknown failure";
}

/**
 * Run one store statement, turning a throw into a typed step failure.
 *
 * @param doing what the statement was for
 * @returns its answer, or the failure
 */
export async function storeStep<T>({
  doing,
  statement,
}: {
  doing: string;
  statement: () => Promise<T>;
}): Promise<Result<T, StoreStepFailure>> {
  try {
    return ok(await statement());
  } catch (cause) {
    return err({ doing, reason: stepReason({ cause }) });
  }
}

/**
 * The step failure for a marker claiming records over a table that holds none.
 *
 * @param records how many the marker says were imported
 * @returns the failure every register names in its own terms
 */
function lostRows({ records }: { records: number }): MarkerStepFailure {
  return {
    doing: "trust its import marker",
    markerInconsistency: { expected: records, observed: 0 },
    reason: `the marker says ${String(records)} record(s) were imported from the old file, and the table holds none`,
  };
}

/**
 * The step failure for a counted marker whose count its tables do not hold exactly — fewer means imported rows
 * were lost, more means the file was imported a second time behind a marker that went missing.
 *
 * @param records how many the marker says were imported
 * @param observed how many rows the import wrote that the tables hold
 * @returns the failure
 */
function countMismatch({ records, observed }: { records: number; observed: number }): MarkerStepFailure {
  return {
    doing: "trust its import marker",
    markerInconsistency: { expected: records, observed },
    reason: `the marker says ${String(records)} record(s) were imported from the old file, and the tables hold ${String(observed)}`,
  };
}

/**
 * Whether a standing marker contradicts what its tables hold. A counted marker is judged by EXACT equality: its
 * probe counts only the rows the import itself wrote, which nothing else writes and nothing deletes, so any other
 * count is a loss or a second import. The single-table probe only by whether any row is there.
 *
 * @param marker the marker as read back
 * @returns the refusal, or undefined when the marker may be trusted
 */
export function markerRefusal({ marker }: { marker: ImportMarker }): MarkerStepFailure | undefined {
  if (marker.observedRows !== undefined) {
    return marker.observedRows === marker.records
      ? undefined
      : countMismatch({ observed: marker.observedRows, records: marker.records });
  }
  return marker.records > 0 && !marker.tableHasRows ? lostRows({ records: marker.records }) : undefined;
}

/**
 * Check an EMPTY full-table read against the marker once more. The marker probe in {@link ensureImported} and
 * the read that follows it are separate statements, so rows deleted between them would otherwise read as an
 * empty register. A read that returned rows needs no second look: what it saw was there.
 *
 * @param rows the marker operations over the open connection
 * @param rowCount how many rows the full-table read returned
 * @param unavailable how this register names a store step that failed
 * @returns nothing when the read may stand, or the refusal
 */
export async function confirmEmptyRead<T, E>({
  rowCount,
  rows,
  unavailable,
}: {
  rowCount: number;
  rows: ImportOnceRows<T>;
  unavailable: (failure: StoreStepFailure) => E;
}): Promise<Result<undefined, E>> {
  if (rowCount > 0) {
    return ok(undefined);
  }
  const marked = await rows.marker();
  if (marked.isErr()) {
    return err(unavailable(marked.error));
  }
  if (marked.value === undefined) {
    return ok(undefined);
  }
  // A counted marker is judged by its count: a register of versions may read zero LIVE rows while holding
  // every row it imported.
  if (marked.value.observedRows !== undefined) {
    const refused = markerRefusal({ marker: marked.value });
    return refused === undefined ? ok(undefined) : err(unavailable(refused));
  }
  if (marked.value.records > 0) {
    return err(unavailable(lostRows({ records: marked.value.records })));
  }
  return ok(undefined);
}

/**
 * Whether a register's import has already run, judged from its marker.
 *
 * @param rows the marker operations over the open connection
 * @param unavailable how this register names a store step that failed
 * @returns true once a sound marker stands, false when no import has run, or the refusal
 */
async function markedImport<T, E>({
  rows,
  unavailable,
}: {
  rows: ImportOnceRows<T>;
  unavailable: (failure: StoreStepFailure) => E;
}): Promise<Result<boolean, E>> {
  const marked = await rows.marker();
  if (marked.isErr()) {
    return err(unavailable(marked.error));
  }
  if (marked.value === undefined) {
    return ok(false);
  }
  // Nothing deletes from these tables, and de-duplicating never folds one record to none, so a marker that
  // imported records over an empty table means the rows were lost: refused, never read as an empty register.
  const refused = markerRefusal({ marker: marked.value });
  if (refused !== undefined) {
    return err(unavailable(refused));
  }
  return ok(true);
}

/**
 * Make sure a register's old file has been imported, reading it only when no marker says it was.
 *
 * @param rows the marker operations over the open connection
 * @param readSource the strict file read, consulted only when there is no marker
 * @param unavailable how this register names a store step that failed
 * @returns nothing once the table is the whole register, or the refusal
 */
export async function ensureImported<T, E>({
  rows,
  readSource,
  unavailable,
}: {
  rows: ImportOnceRows<T>;
  readSource: () => Result<ImportSource<T>, E>;
  unavailable: (failure: StoreStepFailure) => E;
}): Promise<Result<undefined, E>> {
  const marked = await markedImport({ rows, unavailable });
  if (marked.isErr() || marked.value) {
    return marked.map(() => undefined);
  }
  const source = readSource();
  if (source.isErr()) {
    // A racing importer may have committed the marker after the probe above, and from then on the table is the
    // register: a file this call failed to decode no longer answers anything, so ask the marker once more.
    const raced = await markedImport({ rows, unavailable });
    if (raced.isErr() || raced.value) {
      return raced.map(() => undefined);
    }
    return err(source.error);
  }
  // Whether this call won the marker does not matter to the caller: either way the table is now the register.
  const claimed = await rows.claim({ source: source.value });
  if (claimed.isErr()) {
    return err(unavailable(claimed.error));
  }
  return ok(undefined);
}

/**
 * Run one operation over a connection this function opens and always closes.
 *
 * Every seam answers a Result, and production's do; one that rejects anyway is a step that did not finish, so it
 * is the same refusal. A close that fails after a write committed refuses too — retrying meets the key or the
 * revision, which is visible, never a lost change. The plan register's `withRows` is the model.
 *
 * @param connect opens the connection, refusing in this register's own terms
 * @param body what to do with it
 * @param unavailable how this register names a step that threw
 * @returns the body's answer, or the refusal
 */
export async function overConnection<R extends { readonly close: () => Promise<void> }, T, E>({
  body,
  connect,
  unavailable,
}: {
  body: (rows: R) => Promise<Result<T, E>>;
  connect: () => Promise<Result<R, E>>;
  unavailable: (failure: StoreStepFailure) => E;
}): Promise<Result<T, E>> {
  let rows: Result<R, E>;
  try {
    rows = await connect();
  } catch (cause) {
    return err(unavailable({ doing: "be opened", reason: stepReason({ cause }) }));
  }
  if (rows.isErr()) {
    return err(rows.error);
  }
  let answer: Result<T, E>;
  try {
    answer = await body(rows.value);
  } catch (cause) {
    answer = err(unavailable({ doing: "finish the operation", reason: stepReason({ cause }) }));
  }
  try {
    await rows.value.close();
  } catch (cause) {
    // The body's own refusal is the more specific fact, so a failed close never masks it: a lost
    // compare-and-set stays a conflict rather than reading as an outage.
    if (answer.isErr()) {
      return answer;
    }
    return err(unavailable({ doing: "close its connection", reason: stepReason({ cause }) }));
  }
  return answer;
}

/**
 * Lower-case hex sha-256 of a text's UTF-8 bytes.
 *
 * @param text what to digest
 * @returns the digest
 */
export function sha256Hex({ text }: { text: string }): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Read an old JSONL register strictly: every non-blank line must decode, streamed rather than read whole.
 *
 * @param path the file
 * @param decodeLine one line's parsed value to a record, or the sentence saying why it is not one
 * @returns the records in file order, `absent` when there is no file, or the problem
 */
export function readJsonlImportSource<T>({
  path,
  decodeLine,
}: {
  path: string;
  decodeLine: (value: unknown) => Result<T, string>;
}): Result<ImportSource<T>, ImportFileProblem> {
  const records: T[] = [];
  const problems: string[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (line.trim() === "") {
          return;
        }
        const decoded = decodeLineText({ decodeLine, line });
        if (decoded.isErr()) {
          problems.push(`line ${String(index + 1)}: ${decoded.error}`);
          return;
        }
        records.push(decoded.value);
      },
      path,
      // A line holding a byte that is not UTF-8 arrives as one lone U+FFFD, so it fails to parse and the
      // import refuses rather than storing repaired text nobody wrote.
      strictUtf8: true,
    });
  } catch (cause) {
    if (isAbsentError({ error: cause, path })) {
      return ok({ state: "absent" });
    }
    return err({ kind: "unreadable", path, reason: stepReason({ cause }) });
  }
  if (problems.length > 0) {
    return err({ kind: "invalid", path, problems });
  }
  return ok({ records, state: "present" });
}

/** One line's text, parsed and decoded. */
function decodeLineText<T>({
  decodeLine,
  line,
}: {
  decodeLine: (value: unknown) => Result<T, string>;
  line: string;
}): Result<T, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return err("is not JSON");
  }
  return decodeLine(parsed);
}

/**
 * Read an old single-document JSON register strictly. Only for a document whose size is bounded by what it
 * keys, never by how often it was written — `landing-reads.json` holds one entry per selection.
 *
 * @param path the file
 * @param decodeDocument the parsed document to its records, or every problem in it
 * @returns the records, `absent` when there is no file, or the problem
 */
export function readJsonImportSource<T>({
  path,
  decodeDocument,
}: {
  path: string;
  decodeDocument: (value: unknown) => Result<readonly T[]>;
}): Result<ImportSource<T>, ImportFileProblem> {
  const read = readStrictFileIfPresent({ operation: "read an old register for its import", path });
  if (read.isErr()) {
    return err({ kind: "unreadable", path, reason: read.error.message });
  }
  const text = read.value;
  if (text === null) {
    return ok({ state: "absent" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return err({ kind: "invalid", path, problems: ["the document is not JSON"] });
  }
  const decoded = decodeDocument(parsed);
  if (decoded.isErr()) {
    return err({ kind: "invalid", path, problems: decoded.error });
  }
  return ok({ records: decoded.value, state: "present" });
}

/**
 * One line naming an import problem, for a register's own error message.
 *
 * @param problem what went wrong
 * @returns the sentence
 */
export function importProblemText({ problem }: { problem: ImportFileProblem }): string {
  if (problem.kind === "unreadable") {
    return `${problem.path} could not be read: ${problem.reason}`;
  }
  return `${problem.path} holds a record that does not decode — ${problem.problems.join("; ")}`;
}
