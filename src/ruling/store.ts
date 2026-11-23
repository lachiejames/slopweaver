/**
 * The ruling register's effectful edge: stream the register and a decisions file line by line, read a source
 * document strictly as UTF-8, and append under the register's own operation lock.
 *
 * Only a missing file reads as empty. A file that will not open, a line that will not decode or parse, a blank line
 * anywhere but the end, and rows that contradict one another are each a typed error, and the register is never
 * repaired or rewritten: an append re-reads the whole register under the lock, plans against what it found there,
 * and adds lines after it.
 */
import { readFileSync, statSync, truncateSync } from "node:fs";

import { appendLines } from "#lib/appendSeparator.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { removeEntry } from "#lib/writeAtomic.js";
import { acquireOperationLockDetailed } from "../admit/operationLock.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { type RulingError, RulingErrors } from "./errors.js";
import {
  parseRulingLine,
  projectRulings,
  type RulingProjection,
  type RulingRecord,
  renderRulingLine,
} from "./registry.js";
import { parseSeedDecisionLine, type RulingSeedDecision } from "./seed.js";

/** The operation-lock key every register writer takes. */
const REGISTER_LOCK_KEY = "ruling-register";

/** Whether a thrown value is the filesystem saying nothing is there. */
function isAbsent({ cause }: { cause: unknown }): boolean {
  return isRecord(cause) && cause["code"] === "ENOENT";
}

/** One line a stream delivered. */
interface StreamedLine {
  readonly text: string;
  readonly number: number;
  readonly undecodable: boolean;
}

/**
 * Every line of a line-oriented file, the empty slice after a final newline dropped; `undefined` when there is no
 * file. Any other failure to read throws.
 */
function streamLines({ path }: { path: string }): readonly StreamedLine[] | undefined {
  const lines: StreamedLine[] = [];
  try {
    readJsonlLines({
      noFollow: true,
      onLine: ({ line, index, undecodable }) => {
        lines.push({ number: index + 1, text: line, undecodable });
      },
      path,
      strictUtf8: true,
    });
  } catch (cause) {
    if (isAbsent({ cause })) {
      return undefined;
    }
    throw cause;
  }
  if (lines.at(-1)?.text.length === 0) {
    lines.pop();
  }
  return lines;
}

/** What a line-level parser answers. */
type LineParser<T> = (args: { line: StreamedLine }) => Result<T, RulingError>;

/** Parse every streamed line, refusing an undecodable or blank one before the parser sees it. */
function parseLines<T>({
  lines,
  parse,
  refuse,
}: {
  lines: readonly StreamedLine[];
  parse: LineParser<T>;
  refuse: (args: { line: number; why: string }) => RulingError;
}): Result<readonly T[], RulingError> {
  const parsed: T[] = [];
  for (const line of lines) {
    if (line.undecodable) {
      return err(refuse({ line: line.number, why: "not UTF-8" }));
    }
    if (line.text.trim().length === 0) {
      return err(refuse({ line: line.number, why: "a blank line inside the file" }));
    }
    const one = parse({ line });
    if (one.isErr()) {
      return err(one.error);
    }
    parsed.push(one.value);
  }
  return ok(parsed);
}

/**
 * Read and check the register.
 *
 * @param file the register's path
 * @returns the register — empty when there is no file — or why it cannot be trusted
 */
export function readRulings({ file }: { file: string }): Result<RulingProjection, RulingError> {
  let lines: readonly StreamedLine[] | undefined;
  try {
    lines = streamLines({ path: file });
  } catch (cause) {
    return err(RulingErrors.unreadable({ cause, file }));
  }
  if (lines === undefined) {
    return projectRulings({ file, rows: [] });
  }
  const rows = parseLines({
    lines,
    parse: ({ line }) => parseRulingLine({ file, line: line.text, lineNumber: line.number }),
    refuse: ({ line, why }) => RulingErrors.malformed({ file, line, why }),
  });
  if (rows.isErr()) {
    return err(rows.error);
  }
  return projectRulings({ file, rows: rows.value });
}

/**
 * Read a seed decisions file.
 *
 * @param file the decisions file's path
 * @returns every decision in it, or why it is not a decisions file — a missing file is an error, never empty
 */
export function readSeedDecisions({ file }: { file: string }): Result<readonly RulingSeedDecision[], RulingError> {
  let lines: readonly StreamedLine[] | undefined;
  try {
    lines = streamLines({ path: file });
  } catch (cause) {
    return err(RulingErrors.sourceUnreadable({ cause, file }));
  }
  if (lines === undefined) {
    return err(RulingErrors.seedDecisionsInvalid({ why: `${file} does not exist` }));
  }
  return parseLines({
    lines,
    parse: ({ line }) => parseSeedDecisionLine({ line: line.text, lineNumber: line.number }),
    refuse: ({ line, why }) => RulingErrors.seedDecisionsInvalid({ why: `${file}:${String(line)}: ${why}` }),
  });
}

/**
 * Read one source document as text, refusing bytes that are not UTF-8 rather than repairing them.
 *
 * @param file the document's path
 * @returns its text, or why it could not be read
 */
export function readRulingSource({ file }: { file: string }): Result<string, RulingError> {
  try {
    return ok(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file)));
  } catch (cause) {
    return err(RulingErrors.sourceUnreadable({ cause, file }));
  }
}

/** The register's byte length, or `undefined` when there is no file yet. */
function byteLengthOf({ file }: { file: string }): number | undefined {
  try {
    return statSync(file).size;
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return undefined;
    }
    throw cause;
  }
}

/** Cut the register back to the length it had before an append, or remove it when there was none. */
function restoreLength({ file, length }: { file: string; length: number | undefined }): boolean {
  try {
    if (length === undefined) {
      removeEntry({ path: file });
    } else {
      truncateSync(file, length);
    }
    return true;
  } catch {
    return false;
  }
}

/** The durable, owner-only append the register is written with. */
const appendRegisterText = ({ file, text }: { file: string; text: string }): void => {
  appendLines({ durable: true, mode: 0o600, path: file, text });
};

/**
 * Append rows, or, when the write fails part way, cut the file back to what it held before so a refusal leaves no
 * partial row behind. A process killed mid-write can still leave one; the next read refuses it rather than repairing.
 *
 * @param file the register's path
 * @param records the rows to append, in order
 * @param write the append itself; a test passes one that fails part way
 * @returns nothing on success, or the failure and whether the file was cut back
 */
export function appendOrRestore({
  file,
  records,
  write = appendRegisterText,
}: {
  file: string;
  records: readonly RulingRecord[];
  write?: (args: { file: string; text: string }) => void;
}): Result<undefined, RulingError> {
  let length: number | undefined;
  try {
    length = byteLengthOf({ file });
  } catch (cause) {
    return err(RulingErrors.appendFailed({ cause, file, restored: true }));
  }
  try {
    write({ file, text: records.map((record) => renderRulingLine({ record })).join("\n") });
    return ok(undefined);
  } catch (cause) {
    return err(RulingErrors.appendFailed({ cause, file, restored: restoreLength({ file, length }) }));
  }
}

/** What one append wrote. */
export interface RulingAppendReceipt {
  readonly appended: readonly RulingRecord[];
  /** The register after the append. */
  readonly projection: RulingProjection;
}

/**
 * Append rows to the register under its lock, planning them against the register as read under that same lock.
 *
 * @param home the state home whose operation lock guards the register
 * @param file the register's path
 * @param nowIso the instant the lock attempt is stamped with
 * @param plan decides the rows to append from the register as it stands; a refusal appends nothing
 * @returns the rows appended and the register after, or the first refusal
 */
export function appendRulings({
  home,
  file,
  nowIso,
  plan,
}: {
  home: string;
  file: string;
  nowIso: string;
  plan: (args: { projection: RulingProjection }) => Result<readonly RulingRecord[], RulingError>;
}): Result<RulingAppendReceipt, RulingError> {
  const lock = acquireOperationLockDetailed({ home, key: REGISTER_LOCK_KEY, nowIso });
  if (lock.isErr()) {
    return err(RulingErrors.lockUnavailable({ why: lock.error.message }));
  }
  try {
    const before = readRulings({ file });
    if (before.isErr()) {
      return err(before.error);
    }
    const planned = plan({ projection: before.value });
    if (planned.isErr()) {
      return err(planned.error);
    }
    const after = projectRulings({ file, rows: [...before.value.rows, ...planned.value] });
    if (after.isErr()) {
      return err(after.error);
    }
    if (planned.value.length > 0) {
      const appended = appendOrRestore({ file, records: planned.value });
      if (appended.isErr()) {
        return err(appended.error);
      }
    }
    return ok({ appended: planned.value, projection: after.value });
  } finally {
    lock.value.release();
  }
}
