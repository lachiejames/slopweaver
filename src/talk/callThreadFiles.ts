/**
 * One call's thread journal files as they stand on disk, and their lines read back — the reading half of
 * `./callThreadStore.ts`, which owns the lock and the writes. A journal path is only ever a regular file with one
 * link: a symlink or hard link is refused rather than written through, and a line naming another call is never taken
 * as this call's.
 */
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { descriptorNeedsSeparator } from "../lib/appendSeparator.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse } from "../lib/safeJson.js";
import { fsyncDirectories, writeAll } from "../lib/writeAtomic.js";
import { type StoredCallThreadEntry, storedCallThreadEntryOf } from "./callThreadEntry.js";
import { type CallThreadError, CallThreadErrors } from "./callThreadErrors.js";
import { callThreadFilesOf } from "./callThreadParts.js";

/**
 * One journal file's lines, read tolerantly: a torn or malformed line, or one naming another call, is counted, never
 * fatal and never taken as this call's.
 *
 * @param path the file
 * @param callId the call whose journal this file is, which every kept entry must name
 * @returns the stored entries in order, and how many lines were not kept
 */
export function readJournalFile({ path, callId }: { path: string; callId: string }): {
  entries: StoredCallThreadEntry[];
  skipped: number;
} {
  const entries: StoredCallThreadEntry[] = [];
  let skipped = 0;
  readJsonlLines({
    onLine: ({ line }) => {
      if (line.trim() === "") {
        return;
      }
      let entry: StoredCallThreadEntry | undefined;
      try {
        entry = storedCallThreadEntryOf({ value: safeJsonParse({ label: "call-thread journal line", text: line }) });
      } catch {
        entry = undefined;
      }
      if (entry === undefined || entry.callId !== callId) {
        skipped += 1;
      } else {
        entries.push(entry);
      }
    },
    path,
  });
  return { entries, skipped };
}

/**
 * The stored line of each `writeId` in one journal file, a line whose id cannot be read left out — so a torn line
 * never blocks a retry of the entry it was.
 *
 * @param path the file
 * @param lines where each id's stored line is added, keyed by its `writeId`
 */
export function collectWrittenLines({ path, lines }: { path: string; lines: Map<string, string> }): void {
  readJsonlLines({
    onLine: ({ line }) => {
      try {
        const entry = storedCallThreadEntryOf({
          value: safeJsonParse({ label: "call-thread journal line", text: line }),
        });
        // Only a line the reader would keep proves its entry written; a malformed one carrying a writeId does not.
        if (entry !== undefined) {
          lines.set(entry.writeId, line);
        }
      } catch {
        // A torn line holds no id; its entry is written again by the retry that carries it.
      }
    },
    path,
  });
}

/**
 * Refuse a threads directory, or the `talk` directory above it, that is a symlink: `O_NOFOLLOW` guards only a
 * journal's own name, and a linked parent would put the journal outside this home. An absent
 * one is fine; `ensureDirectory` makes it a real directory.
 *
 * @param dir the threads directory
 * @returns nothing, or the first linked directory as a path that is not this call's own
 */
export function refuseLinkedDirs({ dir }: { dir: string }): Result<void, CallThreadError> {
  for (const path of [dirname(dir), dir]) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
      return err(CallThreadErrors.notAFile({ path }));
    }
  }
  return ok(undefined);
}

/**
 * This call's journal files, each a regular file with one link: a symlink or a hard link is refused, never written
 * through, because a write through it would land in a file this call's lock does not guard — another call's journal,
 * perhaps.
 *
 * @param dir the threads directory
 * @returns each file's name and index in reading order, or the first path that is not a regular file
 */
export function regularJournalFiles({
  dir,
  callId,
}: {
  dir: string;
  callId: string;
}): Result<readonly { name: string; index: number }[], CallThreadError> {
  const linked = refuseLinkedDirs({ dir });
  if (linked.isErr()) {
    return err(linked.error);
  }
  if (!existsSync(dir)) {
    return ok([]);
  }
  const files = callThreadFilesOf({ callId, names: readdirSync(dir) });
  for (const file of files) {
    const path = join(dir, file.name);
    const stat = lstatSync(path);
    // A hard link is a second name for one inode, perhaps another call's journal, so only a sole link is this call's.
    if (!stat.isFile() || stat.nlink !== 1) {
      return err(CallThreadErrors.notAFile({ path }));
    }
  }
  return ok(files);
}

/** Append-only, created `0600` when absent, a symlink refused at the open (`ELOOP`), a FIFO never waited on. */
const APPEND_FLAGS =
  constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/**
 * Open one journal file for append and pin it: the HELD descriptor must be a regular file with one link, so a name
 * swapped for a link after {@link regularJournalFiles} looked is refused here rather than written through
 * through.
 *
 * @param path the file to append to; its directory exists
 * @returns the held descriptor, or that the path is not this call's own file
 */
function openPinned({ path }: { path: string }): Result<number, CallThreadError> {
  let fd: number;
  try {
    fd = openSync(path, APPEND_FLAGS, 0o600);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ELOOP") {
      return err(CallThreadErrors.notAFile({ path }));
    }
    throw cause;
  }
  const held = fstatSync(fd);
  if (!held.isFile() || held.nlink !== 1) {
    closeSync(fd);
    return err(CallThreadErrors.notAFile({ path }));
  }
  fchmodSync(fd, 0o600);
  return ok(fd);
}

/**
 * Append each file's lines durably, every file opened and pinned before ANY is written — so a refused path leaves the
 * whole batch unwritten, never half of it.
 *
 * @param writes each file's path and the whole lines it gets, each ending in `\n`
 * @returns nothing, or the first path that is not this call's own file
 */
export function appendPinned({
  writes,
}: {
  writes: readonly { readonly path: string; readonly text: string }[];
}): Result<void, CallThreadError> {
  const held: { fd: number; path: string; text: string }[] = [];
  try {
    for (const { path, text } of writes) {
      const opened = openPinned({ path });
      if (opened.isErr()) {
        return err(opened.error);
      }
      held.push({ fd: opened.value, path, text });
    }
    for (const { fd, path, text } of held) {
      const lead = descriptorNeedsSeparator({ fd, path }) ? "\n" : "";
      writeAll({ handle: fd, text: `${lead}${text}` });
      fsyncSync(fd);
    }
  } finally {
    for (const { fd } of held) {
      closeSync(fd);
    }
  }
  fsyncDirectories({ paths: writes.map((write) => write.path) });
  return ok(undefined);
}
