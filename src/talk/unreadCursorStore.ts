/**
 * Where each named reader of `slopweaver talk unread` stands in the call files — its cursor, stored at
 * `$SLOPWEAVER_HOME/talk/unread-cursors/<name>.json`. A cursor that will not parse is an error, never "no cursor":
 * that would move the reader back to the first-read window and hide every word between it and where it stood.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { acquireOperationLock } from "../admit/operationLock.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";
import { writeFileAtomic, writeFileAtomicStream } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

import { type UnreadError, UnreadErrors } from "./unreadErrors.js";
import type { UnreadCursor } from "./unreadWords.js";

/** The cursor the supervisor's sweep reads and marks — one per install, handed from chair to chair. */
export const SUPERVISOR_UNREAD_CURSOR = "supervisor";

/** What a cursor name may be: lowercase, digits and hyphens, starting with an alphanumeric, at most 64. */
const CURSOR_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/u;

/** Owner-only, like the call files it points into. */
const DIR_MODE = 0o700;

// Strict throughout: a field no mark writes makes the cursor non-canonical, so it is refused rather than stripped
// and rewritten canonical past words never printed.
const frontierSchema = z.strictObject({
  // 0 only for a line read in parts from the very start of a file (`./unreadParts.ts`).
  offset: z.number().int().nonnegative(),
  part: z
    .strictObject({
      lineOffset: z.number().int().nonnegative().exactOptional(),
      lineSha256: z.string().min(1),
      printed: z.number().int().positive(),
    })
    .exactOptional(),
  prefixSha256: z.string().min(1),
});

const cursorSchema = z.strictObject({
  calls: z.record(z.string(), frontierSchema),
  // Canonical only, as a mark writes it: a loose date string of any length would swell every report that names it
  // past what a batch prints.
  recordedAtIso: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value, {
      message: "not a canonical ISO instant",
    }),
});

/**
 * Whether a thrown filesystem error says the path is not there.
 *
 * @param cause what was thrown
 * @returns whether its code is `ENOENT`
 */
export function isMissing({ cause }: { cause: unknown }): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}

/**
 * The directory every named reader's cursor lives in, beside the call files under the state-home contract's `talk/`.
 *
 * @param home the Slopweaver home
 * @returns the directory
 */
export function unreadCursorsDir({ home }: { home: string }): string {
  return join(dirname(stateHomePaths({ home }).talkTurns), "unread-cursors");
}

/**
 * Where one named reader's cursor lives, in {@link unreadCursorsDir}.
 *
 * @param home the Slopweaver home
 * @param name the reader, e.g. {@link SUPERVISOR_UNREAD_CURSOR}
 * @returns the path, or why the name cannot be a filename
 */
export function unreadCursorPath({ home, name }: { home: string; name: string }): Result<string, UnreadError> {
  if (!CURSOR_NAME.test(name)) {
    return err(UnreadErrors.cursorNameInvalid({ name }));
  }
  return ok(join(unreadCursorsDir({ home }), `${name}.json`));
}

/**
 * Read one named reader's cursor. Absent is `undefined`; present and unreadable is an error, never absent.
 *
 * @param home the Slopweaver home
 * @param name the reader
 * @returns the cursor, `undefined` when this reader has never marked, or why it could not be read
 */
export function readUnreadCursor({
  home,
  name,
}: {
  home: string;
  name: string;
}): Result<UnreadCursor | undefined, UnreadError> {
  const path = unreadCursorPath({ home, name });
  if (path.isErr()) {
    return err(path.error);
  }
  let raw: string;
  try {
    raw = readFileSync(path.value, "utf8");
  } catch (cause) {
    if (isMissing({ cause })) {
      return ok(undefined);
    }
    return err(UnreadErrors.pathFailed({ cause, path: path.value }));
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: "talk unread cursor", text: raw });
  } catch (cause) {
    return err(UnreadErrors.cursorMalformed({ path: path.value, why: String(cause) }));
  }
  const parsed = cursorSchema.safeParse(value);
  if (!parsed.success) {
    return err(UnreadErrors.cursorMalformed({ path: path.value, why: parsed.error.issues[0]!.message }));
  }
  return ok(parsed.data);
}

/**
 * The operation-lock key every cursor WRITE takes. A write re-reads the cursor inside it and refuses when it moved
 * since the read the write was computed from, so no two marks can overwrite each other with a cursor built on what it
 * no longer is.
 */
export const UNREAD_CURSOR_LOCK_KEY = "talk-unread-cursor";

/**
 * Whether two reads of one cursor are the same cursor — what a write compares, inside the lock, against the cursor its
 * read was taken from.
 *
 * @param read the cursor the write was computed from, `undefined` for a reader that had never marked
 * @param current the cursor as it stands now
 * @returns true when nothing moved between them
 */
export function sameUnreadCursor({
  read,
  current,
}: {
  read: UnreadCursor | undefined;
  current: UnreadCursor | undefined;
}): boolean {
  if (read === undefined || current === undefined) {
    return read === current;
  }
  return (
    safeJsonStringify({ label: "talk unread cursor", value: read }) ===
    safeJsonStringify({ label: "talk unread cursor", value: current })
  );
}

/**
 * Store one named reader's cursor only when it is still the cursor `read` was — under {@link UNREAD_CURSOR_LOCK_KEY},
 * re-read inside the lock — so a write computed from a cursor that has since moved is refused rather than written
 * over the move.
 *
 * @param home the Slopweaver home
 * @param name the reader
 * @param read the cursor the new one was computed from, `undefined` when the reader had none
 * @param cursor where it now stands
 * @param nowIso the instant the lock is taken at
 * @returns the path written, or why it was not
 */
export function writeUnreadCursorIfUnmoved({
  home,
  name,
  read,
  cursor,
  nowIso,
}: {
  home: string;
  name: string;
  read: UnreadCursor | undefined;
  cursor: UnreadCursor;
  nowIso: string;
}): Result<string, UnreadError> {
  return underUnmovedCursor({ home, name, nowIso, read, write: () => writeUnreadCursor({ cursor, home, name }) });
}

/**
 * Store one named reader's cursor exactly as {@link writeUnreadCursorIfUnmoved} does, with one record kept BEHIND it:
 * the new cursor is staged and fsync-ready, `record` runs, and only a record that stored installs the cursor. So a
 * record that fails — an append refused, a disk full — leaves the cursor where it was, and a cursor never moves without
 * its record. The one order this cannot give is the reverse: a staged cursor whose fsync or rename then fails, or a
 * process dying between the record and the rename, leaves a record naming a move that did not happen — reported as
 * `CURSOR_INSTALL_FAILED` when the process lives to say so. Nothing passes unrecorded in either case.
 *
 * @param home the Slopweaver home
 * @param name the reader
 * @param read the cursor the new one was computed from, `undefined` when the reader had none
 * @param cursor where it now stands
 * @param nowIso the instant the lock is taken at
 * @param record what must be stored before the cursor may move; answers the record's path
 * @returns the cursor's path and the record's, or why the cursor did not move
 */
export function writeUnreadCursorBehindRecord({
  home,
  name,
  read,
  cursor,
  nowIso,
  record,
}: {
  home: string;
  name: string;
  read: UnreadCursor | undefined;
  cursor: UnreadCursor;
  nowIso: string;
  record: () => Result<string, UnreadError>;
}): Result<{ cursorPath: string; recordPath: string }, UnreadError> {
  return underUnmovedCursor({
    home,
    name,
    nowIso,
    read,
    write: (path) => installCursorBehindRecord({ cursor, path, record }),
  });
}

/**
 * Run one cursor write under {@link UNREAD_CURSOR_LOCK_KEY}, only when the cursor is still the one `read` was.
 *
 * @param home the Slopweaver home
 * @param name the reader
 * @param read the cursor the write was computed from
 * @param nowIso the instant the lock is taken at
 * @param write the write itself, handed the cursor's path, run inside the lock
 * @returns what the write answered, or why it never ran
 */
function underUnmovedCursor<T>({
  home,
  name,
  read,
  nowIso,
  write,
}: {
  home: string;
  name: string;
  read: UnreadCursor | undefined;
  nowIso: string;
  write: (path: string) => Result<T, UnreadError>;
}): Result<T, UnreadError> {
  const path = unreadCursorPath({ home, name });
  if (path.isErr()) {
    return err(path.error);
  }
  const lock = acquireOperationLock({ home, key: UNREAD_CURSOR_LOCK_KEY, nowIso });
  if (lock.isErr()) {
    return err(UnreadErrors.cursorMoved({ path: path.value, why: `its lock is held: ${lock.error}` }));
  }
  try {
    const current = readUnreadCursor({ home, name });
    if (current.isErr()) {
      return err(current.error);
    }
    if (!sameUnreadCursor({ current: current.value, read })) {
      return err(UnreadErrors.cursorMoved({ path: path.value, why: "it moved since this read was taken" }));
    }
    return write(path.value);
  } finally {
    lock.value.release();
  }
}

/**
 * Stage the cursor's bytes, run the record while they are still only staged, then install them. A producer that throws
 * leaves the target untouched (`writeFileAtomicStream`), which is what lets a failed record refuse the move.
 *
 * @param cursor where the reader now stands
 * @param path the cursor file
 * @param record what must be stored first
 * @returns both paths, or why the cursor did not move
 */
function installCursorBehindRecord({
  cursor,
  path,
  record,
}: {
  cursor: UnreadCursor;
  path: string;
  record: () => Result<string, UnreadError>;
}): Result<{ cursorPath: string; recordPath: string }, UnreadError> {
  // A holder rather than two `let`s: the producer writes it inside a callback, which control-flow narrowing cannot see.
  const seen: { refused?: UnreadError; recordPath?: string } = {};
  try {
    writeFileAtomicStream({
      dirMode: DIR_MODE,
      fileMode: 0o600,
      path,
      produce: ({ write }) => {
        write({ text: `${safeJsonStringify({ label: "talk unread cursor", value: cursor })}\n` });
        const stored = record();
        if (stored.isErr()) {
          seen.refused = stored.error;
          throw new Error(stored.error.message);
        }
        seen.recordPath = stored.value;
      },
    });
  } catch (cause) {
    if (seen.refused !== undefined) {
      return err(seen.refused);
    }
    if (seen.recordPath !== undefined) {
      return err(UnreadErrors.cursorInstallFailed({ cause, path, recordPath: seen.recordPath }));
    }
    return err(UnreadErrors.pathFailed({ cause, path }));
  }
  // The producer ran to its end without throwing, so the record stored: an invariant, not a fallback.
  return ok({ cursorPath: path, recordPath: seen.recordPath! });
}

/**
 * Store one named reader's cursor atomically, in a `0700` directory.
 *
 * @param home the Slopweaver home
 * @param name the reader
 * @param cursor where it now stands
 * @returns the path written, or why it could not be
 */
export function writeUnreadCursor({
  home,
  name,
  cursor,
}: {
  home: string;
  name: string;
  cursor: UnreadCursor;
}): Result<string, UnreadError> {
  const path = unreadCursorPath({ home, name });
  if (path.isErr()) {
    return err(path.error);
  }
  try {
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: "talk unread cursor", value: cursor })}\n`,
      dirMode: DIR_MODE,
      fileMode: 0o600,
      path: path.value,
    });
  } catch (cause) {
    return err(UnreadErrors.pathFailed({ cause, path: path.value }));
  }
  return ok(path.value);
}
