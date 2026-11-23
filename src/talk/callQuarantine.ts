/**
 * Accept one gone console-voice call on the record (`./callQuarantineLedger.ts`), so `talk unread` reads past it.
 *
 * Only a TRUE absence is accepted: `lstat` must say nothing is at the call's path. A file that is there, however
 * damaged — torn, rewritten, a directory, a FIFO, a dangling link — is a repair case, never a loss to accept unread.
 * The call must also be one a read would refuse: named by the call index or by some reader's cursor.
 *
 * Two locks serialise the decision. The ledger's own lock spans its read, the duplicate check and the append, so two
 * quarantines never both decide no row exists. The call's own append lock (`./callLock.ts`) spans the absence check,
 * because `talk transcript` indexes a call BEFORE its first line lands, under that lock — without it, a call in that
 * window would read as gone. Ledger first, then call; an append takes only the call's, so the order never inverts.
 */
import { chmodSync, lstatSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { appendLines } from "../lib/appendSeparator.js";
import { err, ok, type Result } from "../lib/result.js";
import { ensureDirectory } from "../lib/writeAtomic.js";

import { CALL_LOCK_WAIT_MS, holdCallLock } from "./callLock.js";
import { type CallQuarantineError, CallQuarantineErrors } from "./callQuarantineErrors.js";
import {
  type CallQuarantineRow,
  callQuarantinePath,
  isBlank,
  quarantineLine,
  quarantineRowProblem,
  readCallQuarantine,
} from "./callQuarantineLedger.js";
import { callsDir, isCallId } from "./callStore.js";
import { processStartOf, type StartOf } from "./relayLease.js";
import { isMissing, readUnreadCursor, unreadCursorPath, unreadCursorsDir } from "./unreadCursorStore.js";
import { indexedCalls } from "./unreadRead.js";

/**
 * Every call id any reader's cursor names. A file in the cursor directory whose name no cursor could have is not a
 * cursor and is passed over; a cursor that will not read refuses, since it may name the call.
 *
 * @param home the Slopweaver home
 * @returns the ids, or why a cursor could not be read
 */
function cursorCallIds({ home }: { home: string }): Result<ReadonlySet<string>, CallQuarantineError> {
  const dir = unreadCursorsDir({ home });
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch (cause) {
    return isMissing({ cause }) ? ok(new Set()) : err(CallQuarantineErrors.io({ cause, path: dir }));
  }
  const ids = new Set<string>();
  for (const file of names.filter((entry) => entry.endsWith(".json"))) {
    const name = file.slice(0, -".json".length);
    if (unreadCursorPath({ home, name }).isErr()) {
      continue;
    }
    const cursor = readUnreadCursor({ home, name });
    if (cursor.isErr()) {
      return err(CallQuarantineErrors.witnessUnreadable({ why: cursor.error.message }));
    }
    for (const callId of Object.keys(cursor.value === undefined ? {} : cursor.value.calls)) {
      ids.add(callId);
    }
  }
  return ok(ids);
}

/**
 * Whether a read would refuse the call: the index or a cursor names it.
 *
 * @param home the Slopweaver home
 * @param callId the call
 * @returns whether it is known, or why that cannot be established
 */
function isKnownCall({ home, callId }: { home: string; callId: string }): Result<boolean, CallQuarantineError> {
  const indexed = indexedCalls({ home });
  if (indexed.isErr()) {
    return err(CallQuarantineErrors.witnessUnreadable({ why: indexed.error.message }));
  }
  if (indexed.value.includes(callId)) {
    return ok(true);
  }
  return cursorCallIds({ home }).map((ids) => ids.has(callId));
}

/**
 * Under both locks: refuse a present path or a repeat, else append the row.
 *
 * @param home the Slopweaver home
 * @param row the row to append
 * @param path the call file's path
 * @returns the ledger's path, or why nothing was written
 */
function appendUnderLocks({
  home,
  row,
  path,
}: {
  home: string;
  row: CallQuarantineRow;
  path: string;
}): Result<string, CallQuarantineError> {
  try {
    lstatSync(path);
    return err(CallQuarantineErrors.callPresent({ callId: row.callId, path }));
  } catch (cause) {
    if (!isMissing({ cause })) {
      return err(CallQuarantineErrors.io({ cause, path }));
    }
  }
  const held = readCallQuarantine({ home });
  if (held.isErr()) {
    return err(held.error);
  }
  const prior = held.value.find((candidate) => candidate.callId === row.callId);
  if (prior !== undefined) {
    return err(CallQuarantineErrors.already({ atIso: prior.atIso, callId: row.callId }));
  }
  const ledger = callQuarantinePath({ home });
  try {
    appendLines({
      durable: true,
      mode: 0o600,
      path: ledger,
      text: `${quarantineLine({ row })}\n`,
    });
  } catch (cause) {
    return err(CallQuarantineErrors.io({ cause, path: ledger }));
  }
  return ok(ledger);
}

/**
 * Quarantine one gone call: check it is a call a read refuses, take both locks, confirm nothing is at its path and
 * no row already accepts it, then append one row. Nothing is written on any refusal.
 *
 * @param home the Slopweaver home
 * @param callId the call whose file is gone
 * @param reason what removed it and why its words are not the owner's, or are lost
 * @param nowIso the instant recorded as the acceptance
 * @param session the visible session accepting it, `null` when none is named
 * @param lockWaitMs how long to wait for either lock, 10 s unless a test narrows it
 * @param pid the pid each lock names, this process's unless a test stands in another
 * @param startOf a pid's current start time, the real `ps` unless a test makes a holder dead or alive
 * @returns the row written and the ledger's path, or why nothing was
 */
export function quarantineCall({
  home,
  callId,
  reason,
  nowIso,
  session,
  lockWaitMs = CALL_LOCK_WAIT_MS,
  pid = process.pid,
  startOf = (candidate) => processStartOf({ pid: candidate }),
}: {
  home: string;
  callId: string;
  reason: string;
  nowIso: string;
  session: string | null;
  lockWaitMs?: number;
  pid?: number;
  startOf?: StartOf;
}): Result<{ readonly row: CallQuarantineRow; readonly path: string }, CallQuarantineError> {
  if (!isCallId({ callId })) {
    return err(CallQuarantineErrors.callIdInvalid({ callId }));
  }
  if (isBlank({ text: reason })) {
    return err(CallQuarantineErrors.reasonEmpty());
  }
  const row: CallQuarantineRow = { atIso: nowIso, callId, reason, session };
  const problem = quarantineRowProblem({ row });
  if (problem !== undefined) {
    return err(CallQuarantineErrors.rowInvalid({ why: problem }));
  }
  const known = isKnownCall({ callId, home });
  if (known.isErr()) {
    return err(known.error);
  }
  if (!known.value) {
    return err(CallQuarantineErrors.callUnknown({ callId }));
  }
  return appendHoldingLocks({ home, lock: { pid, startOf, waitMs: lockWaitMs }, row }).map((path) => ({ path, row }));
}

/**
 * Take the ledger's lock, then the call's own (the one an append takes), and append the row under both.
 *
 * @param home the Slopweaver home
 * @param row the row to append
 * @param lock the pid each lock names, how a holder's liveness is read, and how long to wait
 * @returns the ledger's path, or why nothing was written
 */
function appendHoldingLocks({
  home,
  row,
  lock: { pid, startOf, waitMs },
}: {
  home: string;
  row: CallQuarantineRow;
  lock: { pid: number; startOf: StartOf; waitMs: number };
}): Result<string, CallQuarantineError> {
  const ledger = callQuarantinePath({ home });
  const dir = callsDir({ home });
  const path = join(dir, `${row.callId}.jsonl`);
  let releaseLedger: () => void;
  try {
    ensureDirectory({ directory: dirname(ledger) });
    chmodSync(dirname(ledger), 0o700);
    ensureDirectory({ directory: dir });
    chmodSync(dir, 0o700);
    releaseLedger = holdCallLock({ path: ledger, pid, startOf, waitMs });
  } catch (cause) {
    return err(CallQuarantineErrors.io({ cause, path: `${ledger}.lock` }));
  }
  try {
    let releaseCall: () => void;
    try {
      releaseCall = holdCallLock({ path, pid, startOf, waitMs });
    } catch (cause) {
      return err(CallQuarantineErrors.io({ cause, path: `${path}.lock` }));
    }
    try {
      return appendUnderLocks({ home, path, row });
    } finally {
      releaseCall();
    }
  } finally {
    releaseLedger();
  }
}
