/**
 * The one writer every workstreams ledger goes through (`reactions.jsonl`, definitions, titles, proposals,
 * who-first): each row validated with its reader's own schema, appended durably, and a failed append put back.
 *
 * Every step of one append goes through ONE descriptor rather than the path, so the file whose tail was read is the
 * file written and the file cut back: a link swapped in at the path between two steps cannot send the append, or its
 * undo, somewhere else.
 */
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";

import type { z } from "zod";

import { errorMessage } from "#lib/errorMessage.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";
import { writeAll } from "#lib/writeAtomic.js";

import { type CandidatesError, CandidatesErrors } from "./candidateErrors.js";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const NEWLINE = 0x0a;

/**
 * A ledger held open for one append: its descriptor, whether this append created the file, its length before the
 * append (so a failed one is cut back to it), and whether its last row has no newline after it — a valid row the
 * reader accepts, which the next append would otherwise run straight on from.
 */
interface OpenLedger {
  readonly fd: number;
  readonly created: boolean;
  readonly size: number;
  readonly unterminated: boolean;
}

/**
 * Close a ledger's descriptor once its outcome is settled. By then the append is durable (fsynced, file and directory)
 * or put back, so a close that fails changes nothing on disk and must not turn either outcome into a different one.
 */
function release({ fd }: { fd: number }): void {
  try {
    closeSync(fd);
  } catch {
    // The outcome is already on disk; a failed close costs at most this one descriptor, and nothing in any ledger.
  }
}

/**
 * Whether an open failed because something already holds the name.
 *
 * @returns true for `EEXIST`
 */
function nameTaken({ error }: { error: unknown }): boolean {
  return isRecord(error) && error["code"] === "EEXIST";
}

/**
 * Open a ledger for one append, creating it when nothing is at the path. A link to nowhere is neither created through
 * nor removed: `O_EXCL` will not follow it, and the plain open then fails, so the append is refused before it writes.
 * A read-only ledger is refused here too, as a write failure, with nothing written.
 *
 * @param path the ledger
 * @returns the open ledger, its length and its tail; a write failure when it will not open for appending, or
 *   unreadable when its tail will not read
 */
function openLedger({ path }: { path: string }): Result<OpenLedger, CandidatesError> {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL, FILE_MODE);
  } catch (error: unknown) {
    if (!nameTaken({ error })) {
      return err(CandidatesErrors.writeFailed({ cause: errorMessage({ error }), path }));
    }
    try {
      fd = openSync(path, constants.O_RDWR | constants.O_APPEND);
    } catch (again: unknown) {
      return err(CandidatesErrors.writeFailed({ cause: errorMessage({ error: again }), path }));
    }
    return existingLedger({ fd, path });
  }
  // `O_EXCL` made this file, so it is empty with no tail to read: no step stands between creating it and the append.
  return ok({ created: true, fd, size: 0, unterminated: false });
}

/**
 * The length and tail of a ledger that was already there. One it cannot read is left exactly as it was.
 *
 * @param fd the ledger, open for appending
 * @param path the ledger, named in the refusal
 * @returns the open ledger, or unreadable with the descriptor closed
 */
function existingLedger({ fd, path }: { fd: number; path: string }): Result<OpenLedger, CandidatesError> {
  try {
    const size = fstatSync(fd).size;
    if (size === 0) {
      return ok({ created: false, fd, size, unterminated: false });
    }
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    return ok({ created: false, fd, size, unterminated: last[0] !== NEWLINE });
  } catch (error: unknown) {
    release({ fd });
    return err(CandidatesErrors.unreadable({ cause: errorMessage({ error }), path }));
  }
}

/**
 * Put a ledger back the way a failed append found it, so a write that stopped part-way (a full disk, say) leaves no
 * partial row for the reader to refuse. The cut-back goes through the append's own descriptor and is flushed before
 * it counts; a file the append created is then unlinked while the path still names that same file, and that removal
 * flushed too. A repair that is not on disk is not reported as one.
 *
 * @param path the ledger
 * @param ledger the ledger as {@link openLedger} found it
 * @returns nothing when it is back as it was, else what stopped the repair, to be named beside the write failure
 */
function undoAppend({ path, ledger }: { path: string; ledger: OpenLedger }): string | null {
  try {
    ftruncateSync(ledger.fd, ledger.created ? 0 : ledger.size);
    fsyncSync(ledger.fd);
    if (ledger.created) {
      const opened = fstatSync(ledger.fd);
      const named = lstatSync(path, { throwIfNoEntry: false });
      if (named !== undefined && named.ino === opened.ino && named.dev === opened.dev) {
        unlinkSync(path);
        flushDirectory({ path });
      }
    }
    return null;
  } catch (error: unknown) {
    return errorMessage({ error });
  }
}

/**
 * Flush the directory holding a ledger, so a name this call added or removed is on disk. Unlike the best-effort flush
 * a staged write uses, a failure here throws: the caller is about to report the change as made, or as undone.
 *
 * @param path the ledger, whose directory is flushed
 */
function flushDirectory({ path }: { path: string }): void {
  const directory = openSync(dirname(path), constants.O_RDONLY);
  try {
    fsyncSync(directory);
  } finally {
    release({ fd: directory });
  }
}

/**
 * Append the text through the ledger's descriptor and make it durable: the file's bytes, then, for a ledger this append
 * created, its directory's entry.
 *
 * @param path the ledger
 * @param ledger the open ledger
 * @param text the lines to append
 */
function appendThrough({ path, ledger, text }: { path: string; ledger: OpenLedger; text: string }): void {
  writeAll({ handle: ledger.fd, text });
  fsyncSync(ledger.fd);
  if (ledger.created) {
    flushDirectory({ path });
  }
}

/**
 * One row as its ledger line: parsed with the ledger's own schema, then serialised under the same size ceiling the
 * reader parses under, so a row too large for the reader is refused here rather than written.
 *
 * @param row the row as the caller built it
 * @param schema the ledger's row schema
 * @returns the parsed row and its line, or the problems that refuse it
 */
function ledgerLine<Row>({
  row,
  schema,
}: {
  row: unknown;
  schema: z.ZodType<Row>;
}): Result<{ parsed: Row; line: string }> {
  const one = schema.safeParse(row);
  if (!one.success) {
    return err(one.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  try {
    return ok({ line: `${safeJsonStringify({ label: "a ledger row", value: one.data })}\n`, parsed: one.data });
  } catch (error: unknown) {
    return err([errorMessage({ error })]);
  }
}

/**
 * Append rows to a workstreams ledger, durably, one JSON line each. Every row is checked against the ledger's own
 * schema first, and one that fails refuses the whole batch with nothing written, so a ledger never holds a row its
 * reader would refuse. A last row left without its newline gets one first, so the new row never runs on from it, and
 * an append that fails part-way is cut back to the length it found.
 *
 * @param path the ledger
 * @param rows the rows, in the order they are appended
 * @param schema the ledger's row schema, the same one its reader parses with
 * @param refusal how this ledger's caller names an input that would not validate
 * @returns the rows as parsed, or the refusal, or the write failure naming the ledger
 */
export function appendLedgerRows<Row>({
  path,
  rows,
  schema,
  refusal,
}: {
  path: string;
  rows: readonly unknown[];
  schema: z.ZodType<Row>;
  refusal: (args: { problems: readonly string[] }) => CandidatesError;
}): Result<readonly Row[], CandidatesError> {
  const parsed: Row[] = [];
  const problems: string[] = [];
  let lines = "";
  for (const row of rows) {
    const one = ledgerLine({ row, schema });
    if (one.isOk()) {
      parsed.push(one.value.parsed);
      lines += one.value.line;
    } else {
      problems.push(...one.error);
    }
  }
  if (problems.length > 0) {
    return err(refusal({ problems }));
  }
  // The owner's first word may come before anything else wrote into the workstreams directory, so it may not exist yet.
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
  } catch (error: unknown) {
    return err(CandidatesErrors.writeFailed({ cause: errorMessage({ error }), path }));
  }
  const opened = openLedger({ path });
  if (opened.isErr()) {
    return err(opened.error);
  }
  const ledger = opened.value;
  try {
    appendThrough({ ledger, path, text: `${ledger.unterminated ? "\n" : ""}${lines}` });
  } catch (error: unknown) {
    const unrepaired = undoAppend({ ledger, path });
    const cause = errorMessage({ error });
    if (unrepaired === null) {
      return err(CandidatesErrors.writeFailed({ cause, path }));
    }
    return err(
      CandidatesErrors.writeFailed({ cause: `${cause}; cutting the partial row back failed: ${unrepaired}`, path }),
    );
  } finally {
    release({ fd: ledger.fd });
  }
  return ok(parsed);
}
