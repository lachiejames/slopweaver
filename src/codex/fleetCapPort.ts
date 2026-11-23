/**
 * The one door every reader and writer of the Codex fleet-cap record goes through, so where the record LIVES is a
 * single decision: the store's singleton `codex_fleet_cap` row (`../store/schema/codexFleetCap.ts`).
 *
 * ## Why there is no file and no import
 *
 * The record was `codex-fleet-cap.json` under the home. It is not imported: it is a snapshot every fleet read
 * replaces, so the first read after this lands files a fresher one than any file holds, and until then the
 * monitor reads "absent" and says no fleet read has run here — which is true of the store. Nothing reads or writes
 * the file any more.
 *
 * ## A store outage is a refusal, never a file
 *
 * No selection, an unreachable database, a failed query: every one is `CODEX_FLEET_CAP_STORE_UNAVAILABLE`, which the
 * monitor reads as `unreadable` and draws unmeasurable. None of them is read as "absent", which would clear a cap card
 * over a record nobody could read (`.claude/rules/typescript-patterns.md` § No silent fallback).
 *
 * ## Filing never fails the read that made it, and never leaves an earlier read standing in for it
 *
 * The routing read is how Codex keeps working, so {@link fileCodexFleetCapRecord} warns on stderr, naming the typed
 * failure, and returns: the pass is not lost. What it must not do is leave the row holding an EARLIER read's answer
 * as though nothing had happened since — a t1 eligible record drawn clear while the t2 read that saw every account
 * capped failed to file. So a filing first marks the row with its own attempt (`./fleetCapUnfiled.ts`), then files,
 * and on a refusal marks it again with why; a read that finds a marker later than the record answers `unfiled`,
 * which the monitor draws unmeasurable until a record at or after that instant lands.
 *
 * ## Injection
 *
 * Only composition roots call {@link codexFleetCapPort}, because `SLOPWEAVER_STORE_URL` in the environment overrides
 * the home's own selection and a test that forgot the port could reach a real store. A unit test passes
 * `memoryCodexFleetCapPort()` (`src/__tests__/codexFleetCapFixture.ts`): this module's real orchestration over a
 * plain in-memory row, a seam rather than a mock (`.claude/rules/testing.md`).
 */
import { errorMessage } from "#lib/errorMessage.js";
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import {
  type CodexFleetCapError,
  CodexFleetCapErrors,
  type CodexFleetCapStoreUnavailableError,
} from "./fleetCapErrors.js";
import { type CodexFleetCapRecord, decodeCodexFleetCapRecord } from "./fleetCapRecord.js";
import { connectCodexFleetCapRows } from "./fleetCapStoreRows.js";
import {
  type CodexFleetCapUnfiled,
  decodeCodexFleetCapUnfiled,
  FILING_UNFINISHED,
  unfiledSupersedesRecord,
} from "./fleetCapUnfiled.js";

/**
 * What reading the record found — a record, nothing filed, a later read that did not file, a row that does not decode,
 * or a store that could not be read at all. The monitor's input: the last three are their own answers, never "absent"
 * and never the earlier record.
 */
export type CodexFleetCapRead =
  | { readonly kind: "absent" }
  | { readonly kind: "record"; readonly record: CodexFleetCapRecord }
  | { readonly kind: "unfiled"; readonly attemptedAtIso: string; readonly why: string }
  | { readonly kind: "malformed"; readonly why: string }
  | { readonly kind: "unreadable"; readonly why: string };

/** The row decoded: the record, and the latest filing attempt's marker when one was ever written. */
export interface CodexFleetCapState {
  readonly record: CodexFleetCapRecord;
  readonly unfiled: CodexFleetCapUnfiled | undefined;
}

/** Whether a filed record landed, or a record judged at a later instant was already there and stays. */
type CodexFleetCapFiling = "filed" | "kept-later";

/** One stored row as the store returned it: the document and the marker, both undecoded. */
interface StoredCodexFleetCap {
  /** `unknown` on purpose — `jsonb` is not validation, so every reader decodes it. */
  readonly document: unknown;
  /** The latest attempt's marker, `null` when no filing ever marked the row; decoded like the document. */
  readonly unfiled: unknown;
}

/** The three statements one open connection offers, and the handle that closes it. */
export interface CodexFleetCapRows {
  /** The singleton row, or undefined when the store holds none. */
  readonly read: () => Promise<Result<StoredCodexFleetCap | undefined, CodexFleetCapStoreUnavailableError>>;
  /** Insert or replace the record unless the one there was judged at a later instant; true when this one landed. */
  readonly fileIfNotOlder: (request: {
    readonly record: CodexFleetCapRecord;
  }) => Promise<Result<boolean, CodexFleetCapStoreUnavailableError>>;
  /** Mark an existing row with an attempt unless a later attempt marked it; true when this marker landed. */
  readonly markUnfiledIfNotOlder: (request: {
    readonly unfiled: CodexFleetCapUnfiled;
  }) => Promise<Result<boolean, CodexFleetCapStoreUnavailableError>>;
  readonly close: () => Promise<void>;
}

/** Open the store one home selects, as the record's statements — the one effect the port is built over. */
export type ConnectCodexFleetCapRows = (request: {
  readonly home: string;
}) => Promise<Result<CodexFleetCapRows, CodexFleetCapStoreUnavailableError>>;

/** The record's two operations, as one value a caller threads rather than two it could mix up. */
export interface CodexFleetCapPort {
  /** The record the last fleet read filed and the latest attempt's marker, undefined when none has, or why not. */
  readonly read: (request: {
    readonly home: string;
  }) => Promise<Result<CodexFleetCapState | undefined, CodexFleetCapError>>;
  /** Mark the attempt, then file one fleet read's conclusion unless a later one is filed; a refusal re-marks why. */
  readonly file: (request: {
    readonly home: string;
    readonly record: CodexFleetCapRecord;
  }) => Promise<Result<CodexFleetCapFiling, CodexFleetCapError>>;
}

/**
 * Run one operation over a connection this function opens and always closes.
 *
 * @param connect where the connection comes from
 * @param home the Slopweaver home whose store is opened
 * @param body what to do with it
 * @returns whatever the body answered, or the refusal of whichever step did not finish
 */
async function withRows<T>({
  body,
  connect,
  home,
}: {
  body: (rows: CodexFleetCapRows) => Promise<Result<T, CodexFleetCapError>>;
  connect: ConnectCodexFleetCapRows;
  home: string;
}): Promise<Result<T, CodexFleetCapError>> {
  // A seam that rejects rather than answering a Result is still a step that did not finish, so it is the same
  // refusal: a raw rejection never stands in for "what the fleet looked like is unknown".
  let rows: Result<CodexFleetCapRows, CodexFleetCapStoreUnavailableError>;
  try {
    rows = await connect({ home });
  } catch (cause) {
    return err(CodexFleetCapErrors.storeUnavailable({ doing: "open", reason: errorMessage({ error: cause }) }));
  }
  if (rows.isErr()) {
    return err(rows.error);
  }
  let answer: Result<T, CodexFleetCapError>;
  try {
    answer = await body(rows.value);
  } catch (cause) {
    answer = err(CodexFleetCapErrors.storeUnavailable({ doing: "finish", reason: errorMessage({ error: cause }) }));
  }
  try {
    await rows.value.close();
  } catch (cause) {
    return err(CodexFleetCapErrors.storeUnavailable({ doing: "close", reason: errorMessage({ error: cause }) }));
  }
  return answer;
}

/**
 * Read and decode the singleton row.
 *
 * @param rows the open connection's statements
 * @returns the record and its marker, undefined when none is filed, or why it cannot be had
 */
async function readWith({
  rows,
}: {
  rows: CodexFleetCapRows;
}): Promise<Result<CodexFleetCapState | undefined, CodexFleetCapError>> {
  const stored = await rows.read();
  if (stored.isErr()) {
    return err(stored.error);
  }
  if (stored.value === undefined) {
    return ok(undefined);
  }
  const decoded = decodeCodexFleetCapRecord({ value: stored.value.document });
  if ("why" in decoded) {
    return err(CodexFleetCapErrors.malformed({ why: decoded.why }));
  }
  if (stored.value.unfiled === null) {
    return ok({ record: decoded.record, unfiled: undefined });
  }
  // A marker that does not decode cannot be shown to be older than the record, so the row is not judged at all.
  const marker = decodeCodexFleetCapUnfiled({ value: stored.value.unfiled });
  if ("why" in marker) {
    return err(CodexFleetCapErrors.malformed({ why: `filing marker ${marker.why}` }));
  }
  return ok({ record: decoded.record, unfiled: marker.unfiled });
}

/**
 * Mark the attempt, file the record, and on a refusal mark the attempt again with why — over one connection, so the
 * marker is in the row before the record's own statement can fail.
 *
 * @param rows the open connection's statements
 * @param record the record this read built
 * @returns whether the record landed, or the record statement's refusal
 */
async function fileWith({
  record,
  rows,
}: {
  record: CodexFleetCapRecord;
  rows: CodexFleetCapRows;
}): Promise<Result<CodexFleetCapFiling, CodexFleetCapError>> {
  const attemptedAtIso = record.readAtIso;
  // Its own refusal changes nothing below: the record is attempted either way, and a record that lands settles it.
  await rows.markUnfiledIfNotOlder({ unfiled: { attemptedAtIso, why: FILING_UNFINISHED } });
  const landed = await rows.fileIfNotOlder({ record });
  if (landed.isErr()) {
    await rows.markUnfiledIfNotOlder({ unfiled: { attemptedAtIso, why: landed.error.message } });
    return err(landed.error);
  }
  return ok(landed.value ? "filed" : "kept-later");
}

/**
 * A fleet-cap port whose authority is the store row, over whichever connection it is handed.
 *
 * @param connect the one effect — production's is `./fleetCapStoreRows.ts`'s `connectCodexFleetCapRows`
 * @returns the port
 */
export function storeCodexFleetCapPort({ connect }: { connect: ConnectCodexFleetCapRows }): CodexFleetCapPort {
  return {
    file: ({ home, record }) => withRows({ body: (rows) => fileWith({ record, rows }), connect, home }),
    read: ({ home }) => withRows({ body: (rows) => readWith({ rows }), connect, home }),
  };
}

/**
 * The port this install's record is reached through: the store.
 *
 * @returns the port every production reader and writer uses
 */
export function codexFleetCapPort(): CodexFleetCapPort {
  return storeCodexFleetCapPort({ connect: connectCodexFleetCapRows });
}

/**
 * The monitor's reading of one port read: a store failure is `unreadable`, a row that does not decode `malformed`, and
 * a record an attempt strictly later than it never replaced `unfiled`.
 *
 * @param result what the port answered
 * @returns the read the monitor evaluators take
 */
export function codexFleetCapReadOf({
  result,
}: {
  result: Result<CodexFleetCapState | undefined, CodexFleetCapError>;
}): CodexFleetCapRead {
  if (result.isErr()) {
    if (result.error.code === "CODEX_FLEET_CAP_MALFORMED") {
      return { kind: "malformed", why: result.error.why };
    }
    return { kind: "unreadable", why: result.error.message };
  }
  if (result.value === undefined) {
    return { kind: "absent" };
  }
  const { record, unfiled } = result.value;
  if (unfiled !== undefined && unfiledSupersedesRecord({ record, unfiled })) {
    return { attemptedAtIso: unfiled.attemptedAtIso, kind: "unfiled", why: unfiled.why };
  }
  return { kind: "record", record };
}

/**
 * Read the record the last fleet read filed, as the monitor takes it.
 *
 * @param home the Slopweaver home whose store is read
 * @param port where the record lives
 * @returns the monitor's read
 */
export async function readCodexFleetCapRecord({
  home,
  port,
}: {
  home: string;
  port: CodexFleetCapPort;
}): Promise<CodexFleetCapRead> {
  return codexFleetCapReadOf({ result: await port.read({ home }) });
}

/**
 * File what one fleet read concluded, warning rather than failing when it cannot be filed.
 *
 * @param home the Slopweaver home whose store is written
 * @param port where the record lives
 * @param record the record this read built
 */
export async function fileCodexFleetCapRecord({
  home,
  port,
  record,
}: {
  home: string;
  port: CodexFleetCapPort;
  record: CodexFleetCapRecord;
}): Promise<void> {
  const filed = await port.file({ home, record });
  if (filed.isOk()) {
    return;
  }
  try {
    logger.warn({
      msg:
        "codex fleet-cap record was not filed; where the store took this read's attempt marker the monitor reads " +
        `unmeasurable until a later read files: ${filed.error.message}`,
    });
  } catch {
    // The warning sink itself failed; the row's marker still says so, and routing must not stop for it.
  }
}
