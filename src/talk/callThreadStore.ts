/**
 * Each console call's thread journal on disk: `$SLOPWEAVER_HOME/talk/threads/<callId>.jsonl` (then `.part-NNNNNN`
 * files, `./callThreadParts.ts`), what the call's Codex thread was told, every turn frame and completed item, and every
 * tool answer the console handed it. The thread is started `ephemeral`
 * (`./planSession.ts`), so without this nothing on the machine holds what the thinking model reasoned or read.
 *
 * ## Out of every investigation path, by directory
 *
 * The journal holds what the model read — tool text, web results, reasoning — so it must never become context. Every
 * call reader (`./callStore.ts`, `./recallRead.ts`, `./recallOpenRead.ts`, `./answerContextRead.ts`) reads `talk/calls`
 * by name, and only this module, `talk call-thread-append` and `talk call-thread` know `talk/threads`.
 * `src/__tests__/unit/talk/callThreadIsolation.test.ts` is the witness: journal-only text a recall or a call read could
 * reach fails it.
 *
 * ## Append-only, idempotent, private
 *
 * The directory is `0700`, each file `0600`, appended under the call's own lock (`./callLock.ts`). A batch posted again
 * after an unknown outcome carries the same `writeId`s, and an entry already in any part is not written twice — but
 * only when the stored line is the one this entry would write; the same id on a different capture is refused. A torn
 * last line is skipped and counted on read, as a call file's is.
 */
import { chmodSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse } from "../lib/safeJson.js";
import { ensureDirectory } from "../lib/writeAtomic.js";
import { isCallId } from "./callId.js";
import { CALL_LOCK_WAIT_MS, holdCallLock } from "./callLock.js";
import { threadsDir } from "./callThreadDir.js";
import { type CallThreadWireEntry, callThreadWireEntryOf, type StoredCallThreadEntry } from "./callThreadEntry.js";
import { type CallThreadError, CallThreadErrors } from "./callThreadErrors.js";
import {
  appendPinned,
  collectWrittenLines,
  readJournalFile,
  refuseLinkedDirs,
  regularJournalFiles,
} from "./callThreadFiles.js";
import { callThreadFileName, placeLines } from "./callThreadParts.js";
import { sanitiseCallThreadEntry, storedLine, survivingSecretLabels } from "./callThreadSanitise.js";
import { processStartOf, type StartOf } from "./relayLease.js";

/** The most entries one staged batch may carry: a turn's items, never a call's backlog in one write. */
const CALL_THREAD_BATCH_MAX = 500;

/** What a batch is read from, as its refusals name it: a staged file's path, or `stdin`. */
const STDIN_SOURCE = "stdin";

/**
 * A line collector for a batch: every non-blank line must be a wire entry for `callId`.
 *
 * @param callId the call the verb was told the batch is for
 * @returns the per-line callback, and the entries and bad line numbers it gathers
 */
function batchCollector({ callId }: { callId: string }): {
  readonly onLine: (input: { line: string; index: number }) => void;
  readonly entries: CallThreadWireEntry[];
  readonly bad: number[];
} {
  const entries: CallThreadWireEntry[] = [];
  const bad: number[] = [];
  const onLine = ({ line, index }: { line: string; index: number }): void => {
    if (line.trim() === "") {
      return;
    }
    let entry: CallThreadWireEntry | undefined;
    try {
      entry = callThreadWireEntryOf({ value: safeJsonParse({ label: "call-thread batch line", text: line }) });
    } catch {
      entry = undefined;
    }
    if (entry === undefined || entry.callId !== callId) {
      bad.push(index + 1);
      return;
    }
    entries.push(entry);
  };
  return { bad, entries, onLine };
}

/**
 * Read a staged batch: every non-blank line must be a wire entry for `callId`, with no `writeId` twice, or none of it
 * is taken.
 *
 * @param path the batch file a caller staged
 * @param callId the call the verb was told the batch is for
 * @returns the entries, or why the batch is refused
 */
export function readCallThreadBatch({
  path,
  callId,
}: {
  path: string;
  callId: string;
}): Result<readonly CallThreadWireEntry[], CallThreadError> {
  const collected = batchCollector({ callId });
  try {
    readJsonlLines({ onLine: collected.onLine, path });
  } catch (cause) {
    return err(CallThreadErrors.pathFailed({ cause, path }));
  }
  return judgedBatch({ bad: collected.bad, callId, entries: collected.entries, path });
}

/**
 * Parse a batch the console piped on stdin, so the raw, unmasked entries never touch disk on their way to the
 * sanitiser — the same rules as {@link readCallThreadBatch}.
 *
 * @param text the whole of stdin
 * @param callId the call the verb was told the batch is for
 * @returns the entries, or why the batch is refused
 */
export function parseCallThreadBatch({
  text,
  callId,
}: {
  text: string;
  callId: string;
}): Result<readonly CallThreadWireEntry[], CallThreadError> {
  const collected = batchCollector({ callId });
  text.split("\n").forEach((line, index) => {
    collected.onLine({ index, line });
  });
  return judgedBatch({ bad: collected.bad, callId, entries: collected.entries, path: STDIN_SOURCE });
}

/**
 * A collected batch, refused whole for a bad line, a `writeId` twice, or past the batch bound.
 *
 * @param entries the lines that were entries for this call
 * @param bad the 1-based numbers of the lines that were not
 * @param callId the call, for the refusal
 * @param path where it was read from, for the refusal
 * @returns the entries, or why the batch is refused
 */
function judgedBatch({
  entries,
  bad,
  callId,
  path,
}: {
  entries: readonly CallThreadWireEntry[];
  bad: readonly number[];
  callId: string;
  path: string;
}): Result<readonly CallThreadWireEntry[], CallThreadError> {
  if (bad.length > 0) {
    const why = `line(s) ${bad.slice(0, 5).join(", ")} are not call-thread entries for call ${callId}`;
    return err(CallThreadErrors.batchInvalid({ path, why }));
  }
  if (new Set(entries.map((entry) => entry.writeId)).size !== entries.length) {
    return err(CallThreadErrors.batchInvalid({ path, why: "a writeId appears twice" }));
  }
  if (entries.length > CALL_THREAD_BATCH_MAX) {
    const why = `${String(entries.length)} entries is more than the ${String(CALL_THREAD_BATCH_MAX)} one batch may carry`;
    return err(CallThreadErrors.batchInvalid({ path, why }));
  }
  return ok(entries);
}

/**
 * Sanitise and append a batch to one call's journal, rotating into a new part before a file passes its ceiling.
 *
 * @param home the Slopweaver home
 * @param callId the call, a v4 UUID
 * @param entries the batch, already read and checked by {@link readCallThreadBatch}
 * @param denylist the private denylist words every entry is masked against, already loaded
 * @param lockWaitMs how long to wait for another writer of the same call, 10 s unless a test narrows it
 * @param pid the pid this writer's lock names, its own unless a test stands in another
 * @param startOf a pid's current start time, the real `ps` unless a test makes a holder dead or alive
 * @param partMaxBytes the per-file ceiling, the real one unless a test narrows it
 * @returns how many entries went in, how many were already there, and each file written
 */
export function appendCallThreadEntries({
  home,
  callId,
  entries,
  denylist,
  lockWaitMs = CALL_LOCK_WAIT_MS,
  pid = process.pid,
  startOf = (candidate) => processStartOf({ pid: candidate }),
  partMaxBytes,
}: {
  home: string;
  callId: string;
  entries: readonly CallThreadWireEntry[];
  denylist: readonly string[];
  lockWaitMs?: number;
  pid?: number;
  startOf?: StartOf;
  partMaxBytes?: number;
}): Result<
  { readonly appended: number; readonly repeated: number; readonly paths: readonly string[] },
  CallThreadError
> {
  if (!isCallId({ callId })) {
    return err(CallThreadErrors.callInvalid({ callId }));
  }
  const dir = threadsDir({ home });
  const primary = join(dir, callThreadFileName({ callId, index: 0 }));
  try {
    // Before the directory is made or chmodded, so neither follows a linked one out of this home.
    const linked = refuseLinkedDirs({ dir });
    if (linked.isErr()) {
      return err(linked.error);
    }
    ensureDirectory({ directory: dir });
    chmodSync(dir, 0o700);
    const release = holdCallLock({ path: primary, pid, startOf, waitMs: lockWaitMs });
    try {
      return appendUnderLock({ callId, denylist, dir, entries, partMaxBytes });
    } finally {
      release();
    }
  } catch (cause) {
    return err(CallThreadErrors.pathFailed({ cause, path: primary }));
  }
}

/**
 * Each line gathered under the part file it was placed in, in order.
 *
 * @param lines the lines to write
 * @param placed each line's part index, at the same position
 * @returns the lines per part index
 */
function groupByFile({
  lines,
  placed,
}: {
  lines: readonly string[];
  placed: readonly number[];
}): Map<number, string[]> {
  const byFile = new Map<number, string[]>();
  placed.forEach((index, at) => {
    const held = byFile.get(index);
    if (held === undefined) {
      byFile.set(index, [lines[at]!]);
    } else {
      held.push(lines[at]!);
    }
  });
  return byFile;
}

/**
 * Each entry's sanitised line, less those the journal already holds — an id already written with the same line is a
 * retry and skipped, one written with a different line is refused.
 *
 * @param paths the journal files already on disk
 * @returns the lines still to write, each ending in `\n`, or the id written on a different line
 */
function unwrittenLines({
  denylist,
  entries,
  paths,
}: {
  denylist: readonly string[];
  entries: readonly CallThreadWireEntry[];
  paths: readonly string[];
}): Result<string[], CallThreadError> {
  const written = new Map<string, string>();
  for (const path of paths) {
    collectWrittenLines({ lines: written, path });
  }
  const lines: string[] = [];
  for (const entry of entries) {
    const line = storedLine({ entry: sanitiseCallThreadEntry({ denylist, entry }) });
    const stored = written.get(entry.writeId);
    if (stored === undefined) {
      lines.push(`${line}\n`);
    } else if (stored !== line) {
      // A repeated id is a retry only when it carries the same capture; a different one would be dropped unwritten.
      return err(CallThreadErrors.writeIdCollision({ writeId: entry.writeId }));
    }
  }
  return ok(lines);
}

/**
 * The append itself, under the call's lock: skip what is already written, sanitise the rest, place and write it.
 *
 * @param dir the threads directory
 * @param partMaxBytes the per-file ceiling, when a test narrows it
 * @returns what went in, or a batch whose withheld stand-in still carried a secret, or one reusing a written id
 */
function appendUnderLock({
  callId,
  denylist,
  dir,
  entries,
  partMaxBytes,
}: {
  callId: string;
  denylist: readonly string[];
  dir: string;
  entries: readonly CallThreadWireEntry[];
  partMaxBytes: number | undefined;
}): Result<
  { readonly appended: number; readonly repeated: number; readonly paths: readonly string[] },
  CallThreadError
> {
  const listed = regularJournalFiles({ callId, dir });
  if (listed.isErr()) {
    return err(listed.error);
  }
  const files = listed.value;
  const unwritten = unwrittenLines({ denylist, entries, paths: files.map((file) => join(dir, file.name)) });
  if (unwritten.isErr()) {
    return err(unwritten.error);
  }
  const lines = unwritten.value;
  const surviving = lines.flatMap((line) => survivingSecretLabels({ denylist, line }));
  if (surviving.length > 0) {
    return err(CallThreadErrors.secretSurvived({ labels: [...new Set(surviving)] }));
  }
  const last = files.at(-1);
  const lastIndex = last === undefined ? 0 : last.index;
  const lastPath = join(dir, callThreadFileName({ callId, index: lastIndex }));
  const placed = placeLines({
    lastBytes: existsSync(lastPath) ? statSync(lastPath).size : 0,
    lastIndex,
    lineBytes: lines.map((line) => Buffer.byteLength(line, "utf8")),
    ...(partMaxBytes === undefined ? {} : { maxBytes: partMaxBytes }),
  });
  const writes = Array.from(groupByFile({ lines, placed }), ([index, fileLines]) => ({
    path: join(dir, callThreadFileName({ callId, index })),
    text: fileLines.join(""),
  }));
  const appended = appendPinned({ writes });
  if (appended.isErr()) {
    return err(appended.error);
  }
  return ok({
    appended: lines.length,
    paths: writes.map((write) => write.path),
    repeated: entries.length - lines.length,
  });
}

/**
 * Read one call's whole journal, every part in order.
 *
 * @param home the Slopweaver home
 * @param callId the call, a v4 UUID
 * @returns the entries, how many lines did not parse, and the files read — or that the call has no journal
 */
export function readCallThreadEntries({
  home,
  callId,
}: {
  home: string;
  callId: string;
}): Result<
  { readonly entries: readonly StoredCallThreadEntry[]; readonly skipped: number; readonly files: readonly string[] },
  CallThreadError
> {
  if (!isCallId({ callId })) {
    return err(CallThreadErrors.callInvalid({ callId }));
  }
  const dir = threadsDir({ home });
  let files: readonly { name: string; index: number }[];
  try {
    const listed = regularJournalFiles({ callId, dir });
    if (listed.isErr()) {
      return err(listed.error);
    }
    files = listed.value;
  } catch (cause) {
    return err(CallThreadErrors.pathFailed({ cause, path: dir }));
  }
  if (files.length === 0) {
    return err(CallThreadErrors.missing({ callId, path: join(dir, callThreadFileName({ callId, index: 0 })) }));
  }
  const entries: StoredCallThreadEntry[] = [];
  let skipped = 0;
  for (const file of files) {
    const path = join(dir, file.name);
    try {
      const read = readJournalFile({ callId, path });
      for (const entry of read.entries) {
        entries.push(entry);
      }
      skipped += read.skipped;
    } catch (cause) {
      return err(CallThreadErrors.pathFailed({ cause, path }));
    }
  }
  return ok({ entries, files: files.map((file) => join(dir, file.name)), skipped });
}
