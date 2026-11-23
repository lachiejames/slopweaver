/**
 * The effectful half of `slopweaver talk cursor-retire` (`./cursorRetire.ts` is the pure one): read a reader's cursor
 * and run the ordinary `talk unread` read over it, count every call whose bytes before the cursor's frontier changed,
 * and — under the lock every cursor write takes — move the unchanged file into `talk/unread-cursors/retired/` beside a
 * receipt.
 *
 * The cursor is MOVED with one rename, never copied and deleted, so no instant exists with two copies or none; the
 * receipt lands first, and a rename that fails takes the receipt's directory back out, so a failure retires nothing.
 */
import { createHash } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { acquireOperationLock } from "../admit/operationLock.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonStringify } from "../lib/safeJson.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";

import { callsDir, isCallId } from "./callStore.js";
import {
  type CursorRetireAssessment,
  type CursorRetireReceipt,
  cursorRetireReceipt,
  retiredCursorDir,
  retireVerdict,
} from "./cursorRetire.js";
import { type CursorRetireError, CursorRetireErrors } from "./cursorRetireErrors.js";
import { isMissing, readUnreadCursor, UNREAD_CURSOR_LOCK_KEY, unreadCursorPath } from "./unreadCursorStore.js";
import { verifiedPrefix } from "./unreadPrefixProof.js";
import { readUnread } from "./unreadRead.js";
import type { UnreadCursor } from "./unreadWords.js";

/** Owner-only, like the cursors directory it sits in. */
const DIR_MODE = 0o700;

/** Owner-only, like a cursor as a mark writes it. */
const FILE_MODE = 0o600;

/**
 * Every call the cursor names whose file is there and whose bytes before the cursor's frontier are not what was read —
 * all of them, not only the first `talk unread` stops on. A file that is gone is not counted: a read refuses it as
 * `CALL_FILE_GONE` unless a quarantine row accepted the loss.
 *
 * @param home the Slopweaver home
 * @param cursor the parsed cursor
 * @returns the failing call ids, sorted, or why a call file could not be read
 */
function failingCalls({ home, cursor }: { home: string; cursor: UnreadCursor }): Result<string[], CursorRetireError> {
  const dir = callsDir({ home });
  const failing: string[] = [];
  const named = Object.entries(cursor.calls)
    .filter(([callId]) => isCallId({ callId }))
    .toSorted(([a], [b]) => a.localeCompare(b));
  for (const [callId, frontier] of named) {
    const path = join(dir, `${callId}.jsonl`);
    let fd: number;
    try {
      fd = openSync(path, "r");
    } catch (cause) {
      if (isMissing({ cause })) {
        continue;
      }
      return err(CursorRetireErrors.io({ cause, path }));
    }
    try {
      const proof = verifiedPrefix({ callId, fd, frontier, path });
      if (proof.isErr() && proof.error.code === "CALL_PREFIX_CHANGED") {
        failing.push(callId);
      }
    } catch (cause) {
      return err(CursorRetireErrors.io({ cause, path }));
    } finally {
      closeSync(fd);
    }
  }
  return ok(failing);
}

/**
 * Read one reader's cursor and decide whether it is retired: present, refused by the ordinary `talk unread` read with
 * `CALL_PREFIX_CHANGED` or `CURSOR_MALFORMED`, and with every failing call counted. Writes nothing.
 *
 * @param home the Slopweaver home
 * @param name the reader
 * @param nowIso the instant the read is judged at
 * @returns what was found, or why the cursor is not retired
 */
export function assessCursorRetire({
  home,
  name,
  nowIso,
}: {
  home: string;
  name: string;
  nowIso: string;
}): Result<CursorRetireAssessment, CursorRetireError> {
  const path = unreadCursorPath({ home, name });
  if (path.isErr()) {
    return err(CursorRetireErrors.notRetirable({ unreadCode: path.error.code, why: path.error.message }));
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(path.value);
  } catch (cause) {
    if (isMissing({ cause })) {
      return err(CursorRetireErrors.absent({ path: path.value }));
    }
    return err(CursorRetireErrors.io({ cause, path: path.value }));
  }
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
  const verdict = retireVerdict({ path: path.value, read: readUnread({ home, name, nowIso }) });
  if (verdict.isErr()) {
    return err(verdict.error);
  }
  const { cause, why } = verdict.value;
  const base = { cause, name, path: path.value, sourceSha256, why };
  const cursor = readUnreadCursor({ home, name });
  if (cursor.isErr() || cursor.value === undefined) {
    // Absent by design: a cursor that does not parse names no calls to count.
    return ok({ ...base, cursorCallCount: null, failingCallIds: [] });
  }
  const parsed = cursor.value;
  return failingCalls({ cursor: parsed, home }).map((failingCallIds) => ({
    ...base,
    cursorCallCount: Object.keys(parsed.calls).length,
    failingCallIds,
  }));
}

/** What `--apply` did. */
export interface CursorRetireApplied {
  /** The cursor where it now lies. */
  readonly retiredPath: string;
  readonly receiptPath: string;
  readonly receipt: CursorRetireReceipt;
}

/**
 * Inside the cursor's lock: re-check eligibility and the digest, then write the receipt and move the cursor beside it.
 *
 * @param home the Slopweaver home
 * @param name the reader
 * @param nowIso the instant it is retired at
 * @param sourceSha256 the digest the preview printed
 * @param reason why the cursor cannot be trusted
 * @param session the visible session retiring it, `null` when none resolves
 * @returns what was written, or why nothing was
 */
function retireUnderLock({
  home,
  name,
  nowIso,
  sourceSha256,
  reason,
  session,
}: {
  home: string;
  name: string;
  nowIso: string;
  sourceSha256: string;
  reason: string;
  session: string | null;
}): Result<CursorRetireApplied, CursorRetireError> {
  const assessed = assessCursorRetire({ home, name, nowIso });
  if (assessed.isErr()) {
    return err(assessed.error);
  }
  const assessment = assessed.value;
  if (assessment.sourceSha256 !== sourceSha256) {
    return err(CursorRetireErrors.sourceMoved({ actual: assessment.sourceSha256, expected: sourceSha256 }));
  }
  const dir = retiredCursorDir({ home, name, nowIso });
  const retiredPath = join(dir, "cursor.json");
  const receiptPath = join(dir, "receipt.json");
  const receipt = cursorRetireReceipt({ assessment, nowIso, reason, session });
  try {
    mkdirSync(dirname(dir), { mode: DIR_MODE, recursive: true });
    chmodSync(dirname(dir), DIR_MODE);
    // Not recursive: a directory already there for this instant is refused rather than written into.
    mkdirSync(dir, { mode: DIR_MODE });
    chmodSync(dir, DIR_MODE);
  } catch (cause) {
    return err(CursorRetireErrors.io({ cause, path: dir }));
  }
  try {
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: "talk cursor-retire receipt", value: receipt })}\n`,
      dirMode: DIR_MODE,
      fileMode: FILE_MODE,
      path: receiptPath,
    });
    chmodSync(assessment.path, FILE_MODE);
    renameSync(assessment.path, retiredPath);
  } catch (cause) {
    rmSync(dir, { force: true, recursive: true });
    return err(CursorRetireErrors.io({ cause, path: assessment.path }));
  }
  return ok({ receipt, receiptPath, retiredPath });
}

/**
 * Retire one reader's cursor: under {@link UNREAD_CURSOR_LOCK_KEY}, re-check that the ordinary read still refuses it
 * for a reason retiring answers and that its bytes are still the ones the preview hashed, then move it, unchanged, to
 * `talk/unread-cursors/retired/<instant>-<name>/cursor.json` beside a `receipt.json`.
 *
 * @param home the Slopweaver home
 * @param name the reader
 * @param nowIso the instant it is retired at
 * @param sourceSha256 the hex digest the preview printed
 * @param reason why the cursor cannot be trusted
 * @param session the visible session retiring it, `null` when none resolves
 * @returns where the cursor and its receipt now are, or why nothing was moved
 */
export function applyCursorRetire({
  home,
  name,
  nowIso,
  sourceSha256,
  reason,
  session,
}: {
  home: string;
  name: string;
  nowIso: string;
  sourceSha256: string;
  reason: string;
  session: string | null;
}): Result<CursorRetireApplied, CursorRetireError> {
  const lock = acquireOperationLock({ home, key: UNREAD_CURSOR_LOCK_KEY, nowIso });
  if (lock.isErr()) {
    return err(CursorRetireErrors.lockHeld({ why: lock.error }));
  }
  try {
    return retireUnderLock({ home, name, nowIso, reason, session, sourceSha256 });
  } finally {
    lock.value.release();
  }
}
