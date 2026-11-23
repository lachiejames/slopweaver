/**
 * The effectful half of `slopweaver talk unread`: read every call file past a named reader's frontier, taking that
 * reader's cursor from `./unreadCursorStore.ts`. What the lines mean is `./unreadWords.ts`.
 *
 * This is a PROOF read, not the recent view `./callStore.ts`'s `readCalls` is, and three choices follow from that.
 * It never filters a file out by its mtime — a clock step or a restored file would hide one. A whole line that will
 * not parse is handed back to be shown rather than skipped and counted, because it may be the owner's words. And a cursor
 * that will not parse, or a file whose bytes before the cursor are not what was read, is an error rather than a
 * fresh start: either would move the reader somewhere it never read from.
 *
 * Every line comes back with the frontier it leaves, so the verb can print a batch and record exactly that far
 * (`./unreadBatch.ts`).
 *
 * Bytes after a file's last newline — in a call file or the call index — refuse the whole read. They are a write
 * still landing or one that died mid-line, and either may be the owner's words, so a read that skipped them would let a tick
 * record past a word nobody saw; once the newline lands the next read parses the line as any other.
 */
import { createHash } from "node:crypto";
import { closeSync, type Dirent, lstatSync, openSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { nonBlockingFileBytes } from "../lib/presentFile.js";
import { err, ok, type Result } from "../lib/result.js";

import { readCallQuarantine } from "./callQuarantineLedger.js";
import { callIndexPath, callsDir, isCallId } from "./callStore.js";
import { isMissing, readUnreadCursor } from "./unreadCursorStore.js";
import { type UnreadError, UnreadErrors } from "./unreadErrors.js";
import { decodedLine, forEachWholeLine, NEWLINE } from "./unreadLines.js";
import { boundCover, coverEnd, partCountOf } from "./unreadParts.js";
import { trustStillHolds, verifiedPrefix } from "./unreadPrefixProof.js";
import type { CallFrontier, CallTail, TailLine, UnreadRead } from "./unreadWords.js";

/** With no cursor yet, how far back a read shows the owner's words: the 24 hours `supervisor intake` already audits. */
export const UNREAD_BOOTSTRAP_MS = 24 * 60 * 60 * 1000;

/** A newline, as the bytes the hash is fed after each line. */
const NEWLINE_BYTES = Buffer.from([NEWLINE]);

/**
 * Why a frontier standing inside a line read in parts cannot be trusted, if it cannot: no line begins where the
 * parts were cut, the line there is not the one they were cut from, a line between the frontier and it is no longer
 * one it prints, or the cursor says more parts were printed than the line has — a cursor no mark wrote, which clamped
 * would print only the last part and mark the whole line read.
 *
 * @param callId the call
 * @param frontier where the reader stood
 * @param lines the whole lines past it
 * @returns the error, or `undefined` for a frontier with no part or a part that holds
 */
function partFault({
  callId,
  frontier,
  lines,
}: {
  callId: string;
  frontier: CallFrontier | undefined;
  lines: readonly TailLine[];
}): UnreadError | undefined {
  const part = frontier?.part;
  if (frontier === undefined || part === undefined) {
    return undefined;
  }
  const cover = boundCover({ frontier, lines });
  if (cover === undefined || lines[cover]!.sha256 !== part.lineSha256) {
    // Absent by design: a run whose first part was the line at the frontier records no line offset of its own.
    let at = frontier.offset;
    if (part.lineOffset !== undefined) {
      at = part.lineOffset;
    }
    const why = `the line at offset ${String(at)}, read in parts, is not the one its first parts were cut from`;
    return UnreadErrors.callPrefixChanged({ callId, why });
  }
  if (coverEnd({ cover, lines }) === undefined) {
    const why = `a line between offset ${String(frontier.offset)} and the line read in parts is not one that line prints`;
    return UnreadErrors.callPrefixChanged({ callId, why });
  }
  const of = partCountOf({ callId, line: lines[cover]! });
  return part.printed < of ? undefined : UnreadErrors.partBeyondLine({ callId, of, printed: part.printed });
}

/** Where one call file is read from, and the allowance it reads under. */
interface TailScan {
  readonly callId: string;
  readonly fd: number;
  readonly path: string;
  readonly frontier: CallFrontier | undefined;
}

/**
 * Read one open call file past its frontier, checking first that every byte before the frontier is what was read.
 * The prefix check, the lines and the new frontier's hash all come through ONE descriptor, and the hash is fed the
 * very bytes that were parsed — so a file rewritten mid-read can never have its new bytes anchored as the ones
 * printed (a read followed by a reopen to hash would leave that window).
 *
 * @param scan the open file and the allowance
 * @returns what lies past the frontier and how many bytes trail its last newline, or why the file cannot be trusted
 */
function scanCallFile({ scan }: { scan: TailScan }): Result<{ tail: CallTail; trailingBytes: number }, UnreadError> {
  const { callId, fd, frontier } = scan;
  const before = verifiedPrefix({ callId, fd, frontier, path: scan.path });
  if (before.isErr()) {
    return err(before.error);
  }
  const { hash } = before.value;
  const start = frontier === undefined ? 0 : frontier.offset;
  const lines: TailLine[] = [];
  const trailingBytes = forEachWholeLine({
    fd,
    onLine: ({ bytes, byteOffset }) => {
      // Every line's own hash, so a part run can bind to whichever line it prints (`./unreadParts.ts`).
      const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      hash.update(bytes);
      hash.update(NEWLINE_BYTES);
      // The frontier after EVERY line, so a batch may stop after any one and record exactly that far.
      const after = { offset: byteOffset + bytes.length + 1, prefixSha256: `sha256:${hash.copy().digest("hex")}` };
      const { entry, text } = decodedLine({ bytes });
      if (entry === undefined) {
        lines.push({ after, kind: "unparseable", line: { byteOffset, callId, text }, sha256 });
      } else {
        lines.push({ after, entry, kind: "entry", sha256 });
      }
    },
    end: Number.POSITIVE_INFINITY,
    start,
  });
  const { trustedOn } = before.value;
  if (trustedOn !== undefined && !trustStillHolds({ fd, path: scan.path, trustedOn })) {
    // The file moved while a kept proof stood in for its prefix: read it again with no proof, as the uncached read
    // would have. Bounded: the proof is forgotten, so the second scan reads every byte.
    return scanCallFile({ scan });
  }
  const fault = partFault({ callId, frontier, lines });
  if (fault !== undefined) {
    return err(fault);
  }
  return ok({ tail: { ...before.value.facts, callId, lines, start: frontier }, trailingBytes });
}

/**
 * Open one call file and read it past its frontier.
 *
 * @param path the call file
 * @param scan everything but the descriptor
 * @returns what lies past the frontier, or why the file cannot be trusted
 */
function readCallTail({
  path,
  scan,
}: {
  path: string;
  scan: Omit<TailScan, "fd" | "path">;
}): Result<CallTail, UnreadError> {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (cause) {
    return err(UnreadErrors.pathFailed({ cause, path }));
  }
  try {
    return scanCallFile({ scan: { ...scan, fd, path } }).andThen((tail) => {
      if (tail.trailingBytes > 0) {
        return err(UnreadErrors.tailUnterminated({ bytes: tail.trailingBytes, path }));
      }
      return ok(tail.tail);
    });
  } catch (cause) {
    return err(UnreadErrors.pathFailed({ cause, path }));
  } finally {
    closeSync(fd);
  }
}

/**
 * Every call file in the calls directory, by name — none when the directory does not exist yet.
 *
 * @param dir the calls directory
 * @returns each call's id and file, sorted, or why the directory could not be listed
 */
function callFiles({ dir }: { dir: string }): Result<readonly { callId: string; path: string }[], UnreadError> {
  let names: readonly Dirent[];
  try {
    names = readdirSync(dir, { withFileTypes: true });
  } catch (cause) {
    return isMissing({ cause }) ? ok([]) : err(UnreadErrors.pathFailed({ cause, path: dir }));
  }
  return ok(
    names
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => ({ callId: entry.name.replace(/\.jsonl$/u, ""), path: join(dir, entry.name) }))
      .filter((file) => isCallId({ callId: file.callId }))
      .toSorted((a, b) => a.callId.localeCompare(b.callId)),
  );
}

/**
 * Every call id the call index records (`callIndexPath`) — none when there is no index yet.
 *
 * @param home the Slopweaver home
 * @returns the ids, or why the index could not be read
 */
export function indexedCalls({ home }: { home: string }): Result<readonly string[], UnreadError> {
  const path = callIndexPath({ home });
  let text: string;
  try {
    // Non-blocking, so a FIFO at the index's path is refused rather than hanging every reader of it.
    text = nonBlockingFileBytes({ path }).toString("utf8");
  } catch (cause) {
    return isMissing({ cause }) ? ok([]) : err(UnreadErrors.pathFailed({ cause, path }));
  }
  if (text === "") {
    return ok([]);
  }
  // Strict: the store writes only `<id>\n`, so any other line is damage, and filtering it out would forget exactly
  // the call whose file went missing. An id whose newline never landed is refused as a call
  // file's is: a write still landing, or one that died.
  if (!text.endsWith("\n")) {
    const bytes = Buffer.byteLength(text.slice(text.lastIndexOf("\n") + 1));
    return err(UnreadErrors.tailUnterminated({ bytes, path }));
  }
  const ids = text.slice(0, -1).split("\n");
  const bad = ids.findIndex((callId) => !isCallId({ callId }));
  if (bad !== -1) {
    return err(UnreadErrors.callIndexMalformed({ lineNumber: bad + 1, path }));
  }
  return ok(ids);
}

/**
 * Whether nothing at all is at a path — not a file, a directory, nor a link, dangling or not. A path that cannot be
 * examined is not absent.
 *
 * @param path the path
 * @returns whether `lstat` says nothing is there
 */
function pathAbsent({ path }: { path: string }): boolean {
  try {
    lstatSync(path);
    return false;
  } catch (cause) {
    return isMissing({ cause });
  }
}

/**
 * Whether a path is a directory itself, never a link to one.
 *
 * @param path the path
 * @returns whether `lstat` says it is a directory
 */
function isRealDirectory({ path }: { path: string }): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read every call file past one named reader's frontier. A call the cursor has never seen is read from its start;
 * with no cursor at all, the bootstrap floor says how far back its words are shown, unless `all` lifts it. A call
 * the cursor has read, or the call index records, whose file is gone is refused: a file deleted with unread lines in it
 * would otherwise read as nothing new — unless a quarantine row accepts that loss on the record
 * (`./callQuarantineLedger.ts`), when the read goes past it and names it in `quarantined`.
 *
 * @param home the Slopweaver home
 * @param name the reader
 * @param nowIso the instant the bootstrap floor is measured back from
 * @param all whether to lift the bootstrap floor and show every call from its start
 * @returns the read, or the first reason one file or the cursor could not be trusted
 */
export function readUnread({
  home,
  name,
  nowIso,
  all = false,
}: {
  home: string;
  name: string;
  nowIso: string;
  all?: boolean;
}): Result<UnreadRead, UnreadError> {
  const cursor = readUnreadCursor({ home, name });
  if (cursor.isErr()) {
    return err(cursor.error);
  }
  const files = callFiles({ dir: callsDir({ home }) });
  if (files.isErr()) {
    return err(files.error);
  }
  const indexed = indexedCalls({ home });
  if (indexed.isErr()) {
    return err(indexed.error);
  }
  const ledger = readCallQuarantine({ home });
  if (ledger.isErr()) {
    return err(UnreadErrors.quarantineUnreadable({ why: ledger.error.message }));
  }
  const listed = new Set(files.value.map((file) => file.callId));
  const known = new Set([...Object.keys(cursor.value === undefined ? {} : cursor.value.calls), ...indexed.value]);
  // A row accepts only a TRUE absence, exactly as `talk quarantine` required when it wrote one: a path that holds
  // anything the listing does not read as a call file — a symlink, a directory — is refused as before.
  // An absence is only provable inside a real calls directory: one missing or swapped for a link reads every leaf as
  // gone, so then no row accepts anything.
  const dir = callsDir({ home });
  const acceptedGone = new Set(
    isRealDirectory({ path: dir })
      ? ledger.value
          .map((row) => row.callId)
          .filter((callId) => !listed.has(callId) && pathAbsent({ path: join(dir, `${callId}.jsonl`) }))
      : [],
  );
  const gone = [...known].find((callId) => !listed.has(callId) && !acceptedGone.has(callId));
  if (gone !== undefined) {
    return err(UnreadErrors.callFileGone({ callId: gone }));
  }
  // Only a quarantine this read actually went past is named: a row whose file was since restored reads normally.
  const quarantined = ledger.value.filter((row) => known.has(row.callId) && acceptedGone.has(row.callId));
  const floorIso =
    cursor.value === undefined && !all ? new Date(Date.parse(nowIso) - UNREAD_BOOTSTRAP_MS).toISOString() : undefined;
  const tails: CallTail[] = [];
  for (const { callId, path } of files.value) {
    const tail = readCallTail({ path, scan: { callId, frontier: cursor.value?.calls[callId] } });
    if (tail.isErr()) {
      return err(tail.error);
    }
    tails.push(tail.value);
  }
  return ok({ bootstrapFloorIso: floorIso, cursor: cursor.value, quarantined, tails });
}
