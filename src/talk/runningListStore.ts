/**
 * The running list's file, `$home/talk/running-list.json` (`0600`): read whole, and rewritten whole under its lock.
 * What the list holds and what an append does to it is `./runningList.ts`; this is only where it lives.
 *
 * The lock is held across the read, the duplicate-id check, the numbering and the replace, so two writers — the
 * console route and a fleet session's verb, say — never number two items the same or drop one another's item.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { isAbsentError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { stateHomePaths } from "../stateHome.js";

import { CALL_LOCK_WAIT_MS, holdCallLock } from "./callLock.js";
import { processStartOf, type StartOf } from "./relayLease.js";
import {
  EMPTY_RUNNING_LIST,
  type RunningListDocument,
  type RunningListDraft,
  type RunningListItem,
  runningListDocumentOf,
  withRunningListItem,
} from "./runningList.js";
import { type RunningListError, RunningListErrors } from "./runningListErrors.js";

/** The talk directory's mode: the owner's alone, like every other private directory in the home. */
const DIR_MODE = 0o700;

/** The list file's mode: what the owner pasted is theirs alone. */
const FILE_MODE = 0o600;

/**
 * Read the list. A home that has never held an item reads as the empty list; a file that is there and will not read
 * or decode is an error, never an empty list.
 *
 * @param home the state home
 * @returns the stored list, or why it could not be read
 */
export function readRunningList({ home }: { home: string }): Result<RunningListDocument, RunningListError> {
  const path = stateHomePaths({ home }).talkRunningListJson;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause: unknown) {
    if (isAbsentError({ error: cause, path })) {
      return ok(EMPTY_RUNNING_LIST);
    }
    return err(RunningListErrors.storeIo({ cause, path }));
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: "the running list", text });
  } catch (cause: unknown) {
    return err(
      RunningListErrors.storeUnreadable({ path, why: cause instanceof Error ? cause.message : String(cause) }),
    );
  }
  return runningListDocumentOf({ path, value });
}

/**
 * Add one draft to the list under its lock: a retry of an id the list still holds answers with that item and writes
 * nothing; otherwise the item goes on top, the oldest past ten falls off, and the file is replaced atomically.
 *
 * @param draft a draft `runningListDraftOf` accepted
 * @param nowIso the instant the list takes it, read inside the lock
 * @param waitMs how long to wait for another writer, 10 s unless a test narrows it
 * @param startOf a pid's start time, injected so a dead lock holder is a fixture
 * @returns the item and whether it was added, or why it could not be
 */
export function appendRunningList({
  home,
  draft,
  nowIso,
  waitMs = CALL_LOCK_WAIT_MS,
  startOf = (candidate) => processStartOf({ pid: candidate }),
}: {
  home: string;
  draft: RunningListDraft;
  nowIso: () => string;
  waitMs?: number;
  startOf?: StartOf;
}): Result<{ readonly item: RunningListItem; readonly appended: boolean }, RunningListError> {
  const path = stateHomePaths({ home }).talkRunningListJson;
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
  } catch (cause: unknown) {
    return err(RunningListErrors.storeIo({ cause, path: dirname(path) }));
  }
  let release: () => void;
  try {
    release = holdCallLock({ path, pid: process.pid, startOf, waitMs });
  } catch (cause: unknown) {
    return err(RunningListErrors.lockHeld({ cause, path: `${path}.lock` }));
  }
  try {
    const read = readRunningList({ home });
    if (read.isErr()) {
      return err(read.error);
    }
    const next = withRunningListItem({ atIso: nowIso(), document: read.value, draft });
    if (next.appended) {
      writeFileAtomic({
        contents: `${safeJsonStringify({ label: "the running list", space: 2, value: next.document })}\n`,
        dirMode: DIR_MODE,
        fileMode: FILE_MODE,
        path,
      });
    }
    return ok({ appended: next.appended, item: next.item });
  } catch (cause: unknown) {
    return err(RunningListErrors.storeIo({ cause, path }));
  } finally {
    release();
  }
}
