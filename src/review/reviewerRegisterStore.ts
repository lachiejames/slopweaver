/**
 * The reviewer register's file: `ledgers/reviewers.jsonl`, read whole and appended under one lock.
 *
 * The same shape as `../outbound/github/checksReadLedger.ts`, and for the same reasons: only ENOENT means
 * absent, so an unreachable register never reads as an empty one; a malformed line refuses the read and names
 * its line rather than being skipped; and the append re-reads under the lock, so two readings recorded at once
 * cannot both write the same ask. Rows, validation and the dedupe are pure, in `./reviewerRegister.ts`.
 */
import { mkdirSync, statSync } from "node:fs";

import { acquireOperationLock } from "../admit/operationLock.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { slopweaverHome } from "../homeDir.js";
import { appendLines } from "../lib/appendSeparator.js";
import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonStringify } from "../lib/safeJson.js";
import { stateHomePaths } from "../stateHome.js";
import {
  parseReviewerLine,
  type ReviewerRegisterError,
  ReviewerRegisterErrors,
  type ReviewerRow,
  rowsToAppend,
  validateReviewerRow,
} from "./reviewerRegister.js";

/** Owner-only permissions, as every register under `ledgers/`. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** The lock every writer of this register takes. One register, one key. */
const LOCK_KEY = "reviewer-register";

/** What one append did. */
export interface ReviewerAppendReceipt {
  readonly path: string;
  /** How many rows were written — fewer than offered when an ask was already held. */
  readonly appended: number;
}

/**
 * Whether the register is there, genuinely absent, or present-but-unreachable.
 *
 * @returns `present`, `absent` (ENOENT only), or `unreachable`
 */
function registerPresence({ path }: { path: string }): "present" | "absent" | "unreachable" {
  try {
    statSync(path);
    return "present";
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return "absent";
    }
    return "unreachable";
  }
}

/**
 * Every row one register file holds, in written order.
 *
 * @returns the rows, or the first failure
 */
function readRowsAt({ path }: { path: string }): Result<readonly ReviewerRow[], ReviewerRegisterError> {
  const presence = registerPresence({ path });
  if (presence === "unreachable") {
    return err(ReviewerRegisterErrors.unreadable({ cause: "it could not be reached — check its permissions", path }));
  }
  if (presence === "absent") {
    return ok([]);
  }
  const rows: ReviewerRow[] = [];
  let failure: ReviewerRegisterError | undefined;
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (failure !== undefined || line.trim().length === 0) {
          return;
        }
        const parsed = parseReviewerLine({ line, lineNumber: index + 1 });
        if (parsed.isErr()) {
          failure = parsed.error;
          return;
        }
        rows.push(parsed.value);
      },
      path,
    });
  } catch (cause) {
    return err(ReviewerRegisterErrors.unreadable({ cause: errorMessage({ error: cause }), path }));
  }
  if (failure !== undefined) {
    return err(failure);
  }
  return ok(rows);
}

/**
 * Every row the register holds. An install that has recorded no landing reading since the register existed is
 * empty, which is a fact about the register and not about who was ever asked.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the rows in written order, or the failure
 */
export function readReviewerRegister({ home = slopweaverHome() }: { home?: string } = {}): Result<
  readonly ReviewerRow[],
  ReviewerRegisterError
> {
  return readRowsAt({ path: stateHomePaths({ home }).reviewerRegisterJsonl });
}

/**
 * Append rows, creating the register if it is not there yet. Every row is validated before anything is
 * written, and an ask the register already holds is skipped, so offering a whole reading's trail every tick
 * writes only what is new.
 *
 * @param rows the rows to offer
 * @param nowIso the instant the lock is taken at
 * @param home the state home (defaults to the resolved home)
 * @returns what was written, or the failure — nothing is written on any failure
 */
export function appendReviewerRows({
  rows,
  nowIso,
  home = slopweaverHome(),
}: {
  rows: readonly ReviewerRow[];
  nowIso: string;
  home?: string;
}): Result<ReviewerAppendReceipt, ReviewerRegisterError> {
  const checked: ReviewerRow[] = [];
  for (const row of rows) {
    const valid = validateReviewerRow({ lineNumber: 0, value: row });
    if (valid.isErr()) {
      return err(valid.error);
    }
    checked.push(valid.value);
  }
  const paths = stateHomePaths({ home });
  const path = paths.reviewerRegisterJsonl;
  if (checked.length === 0) {
    return ok({ appended: 0, path });
  }
  try {
    mkdirSync(paths.ledgers, { mode: DIR_MODE, recursive: true });
  } catch (cause) {
    return err(ReviewerRegisterErrors.unreadable({ cause: errorMessage({ error: cause }), path }));
  }
  const lock = acquireOperationLock({ home, key: LOCK_KEY, nowIso });
  if (lock.isErr()) {
    return err(ReviewerRegisterErrors.busy({ why: lock.error }));
  }
  try {
    const held = readRowsAt({ path });
    if (held.isErr()) {
      return err(held.error);
    }
    const fresh = rowsToAppend({ candidates: checked, held: held.value });
    if (fresh.length === 0) {
      return ok({ appended: 0, path });
    }
    const lines = fresh.map((row) => safeJsonStringify({ label: "a reviewer register row", value: row }));
    appendLines({ mode: FILE_MODE, path, text: `${lines.join("\n")}\n` });
    return ok({ appended: fresh.length, path });
  } catch (cause) {
    return err(ReviewerRegisterErrors.unreadable({ cause: errorMessage({ error: cause }), path }));
  } finally {
    lock.value.release();
  }
}
