/**
 * The private-terms file's lock: one file beside it, created exclusively, holding its holder's pid and a random
 * token, so the lock a process took is the one it later checks and releases. `./privateTermsStore.ts` runs every
 * confirm, answer and retire inside `underTermsLock`, and each verb passes `processPidAlive` as its liveness check.
 *
 * ## A stale lock is cleared only if it is still the one that was judged stale
 *
 * A lock whose pid is gone is cleared, and two processes can judge the same dead lock at once. Deleting it by path
 * would let the slower one delete the faster one's LIVE lock, after which both believe they hold it and a confirm and a
 * retire of one proposal can both succeed. So a clear first RENAMES the lock aside, which is atomic, and compares what
 * it moved with what it judged: the same bytes are the dead lock and are removed; other bytes are a live lock taken in
 * between, which is linked back into place (a link refuses to replace a file, so it never clobbers a third holder) and
 * this caller is told the lock is held. Release removes the lock only while it still holds this caller's token.
 *
 * A lock is created WHOLE, staged with its token and linked into place, so no reader ever sees an empty lock being
 * taken and judges it stale.
 *
 * The residue: a link back can fail because a third take landed in that instant, and then the second holder's lock is
 * gone while it still runs. That needs a third take racing over a dead lock (another edit, or one process taking the
 * lock again while it already holds it, which no caller here does), and a writer that ignores the lock entirely is a
 * wider hole beside it (`docs/security/write-transports.md`).
 */
import { randomBytes } from "node:crypto";
import { linkSync, readFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { createFileExclusive, ensureDirectory, removeEntry } from "#lib/writeAtomic.js";

import { stateHomePaths } from "../stateHome.js";
import { type PrivateTermsStoreError, PrivateTermsStoreErrors } from "./privateTermsStoreErrors.js";

/** Whether a pid names a running process, injected so the stale-lock branch is testable. */
export type PidAlive = (input: { readonly pid: number }) => boolean;

/** Why the lock was not taken: held by a live process, or a filesystem failure. */
export type PrivateTermsLockRefusal =
  { readonly kind: "held"; readonly why: string } | { readonly kind: "io"; readonly cause: unknown };

/** A lock this process holds: where it is and the exact bytes it wrote there. */
export interface PrivateTermsLock {
  readonly path: string;
  readonly token: string;
}

/** One pass at the lock: taken, worth one more pass after a release or a clear, or refused. */
type LockAttempt =
  | { readonly kind: "taken" }
  | { readonly kind: "again" }
  | { readonly kind: "refused"; readonly refusal: PrivateTermsLockRefusal };

/** Whether an error is the filesystem saying the path is not there. */
function isMissing({ error }: { error: unknown }): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}

/**
 * Create the lock WHOLE: the token is written to a private staged file first and then linked into place, which
 * refuses with EEXIST when a lock is there. An exclusive open would expose an EMPTY lock before its token was written,
 * and a reader that judged that empty file stale would clear a lock being taken.
 */
function createLockWhole({ path, token }: { path: string; token: string }): void {
  const staged = `${path}.taking-${randomBytes(6).toString("hex")}`;
  createFileExclusive({ contents: token, mode: 0o600, path: staged });
  try {
    linkSync(staged, path);
  } finally {
    removeEntry({ path: staged });
  }
}

/**
 * Clear a lock judged stale, only if the file at the path still holds the bytes that were judged.
 *
 * @returns true when the stale lock was cleared or already gone, false when a live lock replaced it
 */
function clearStale({ path, judged }: { path: string; judged: string }): boolean {
  const aside = `${path}.clearing-${randomBytes(6).toString("hex")}`;
  try {
    renameSync(path, aside);
  } catch (error: unknown) {
    if (isMissing({ error })) {
      return true;
    }
    throw error;
  }
  const moved = readFileSync(aside, "utf8");
  if (moved === judged) {
    removeEntry({ path: aside });
    return true;
  }
  try {
    linkSync(aside, path);
  } catch {
    // A third process took the lock in this instant; the module header names this residue.
  }
  removeEntry({ path: aside });
  return false;
}

/**
 * Read the lock a create found in place.
 *
 * @returns its bytes, or undefined when it was released between the create and this read
 */
function readJudged({ path }: { path: string }): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error: unknown) {
    if (isMissing({ error })) {
      return undefined;
    }
    throw error;
  }
}

/**
 * The pid a lock names, when that pid still runs.
 *
 * @returns the running holder's pid, or undefined for a dead or unreadable holder
 */
function liveHolder({ judged, pidAlive }: { judged: string; pidAlive: PidAlive }): number | undefined {
  const holder = Number.parseInt(judged.trim(), 10);
  const named = Number.isInteger(holder) && holder > 0;
  return named && pidAlive({ pid: holder }) ? holder : undefined;
}

/**
 * One pass at the lock: create it whole, or judge the one in place and clear it when its holder is gone. A filesystem
 * failure other than the lock existing throws, for the caller to report.
 *
 * @returns taken, again (released or cleared, so one more pass), or refused with why
 */
function attemptOnce({ path, pidAlive, token }: { path: string; pidAlive: PidAlive; token: string }): LockAttempt {
  try {
    createLockWhole({ path, token });
    return { kind: "taken" };
  } catch (error: unknown) {
    if (!isRecord(error) || error["code"] !== "EEXIST") {
      return { kind: "refused", refusal: { cause: error, kind: "io" } };
    }
  }
  const judged = readJudged({ path });
  if (judged === undefined) {
    return { kind: "again" };
  }
  const holder = liveHolder({ judged, pidAlive });
  if (holder !== undefined) {
    return { kind: "refused", refusal: { kind: "held", why: `pid ${String(holder)} holds it and is running` } };
  }
  if (!clearStale({ judged, path })) {
    return { kind: "refused", refusal: { kind: "held", why: "another edit took it as a stale one was being cleared" } };
  }
  return { kind: "again" };
}

/**
 * Take the private-terms lock, clearing one whose holder is gone.
 *
 * @param path the lock file's path
 * @param pidAlive whether a holder's pid still runs
 * @returns the lock now held, or why it was not taken
 */
export function takePrivateTermsLock({
  path,
  pidAlive,
}: {
  path: string;
  pidAlive: PidAlive;
}): Result<PrivateTermsLock, PrivateTermsLockRefusal> {
  const token = `${String(process.pid)} ${randomBytes(6).toString("hex")}\n`;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const outcome = attemptOnce({ path, pidAlive, token });
      if (outcome.kind === "taken") {
        return ok({ path, token });
      }
      if (outcome.kind === "refused") {
        return err(outcome.refusal);
      }
    }
  } catch (error: unknown) {
    return err({ cause: error, kind: "io" });
  }
  return err({ kind: "held", why: "another edit took it again as a stale one was cleared" });
}

/**
 * Release a lock this process took, only while the file still holds this process's token: a lock another process
 * holds is never removed.
 *
 * @param lock the lock as taken
 */
export function releasePrivateTermsLock({ lock }: { lock: PrivateTermsLock }): void {
  let held: string;
  try {
    held = readFileSync(lock.path, "utf8");
  } catch {
    // Already gone: nothing of ours to release.
    return;
  }
  if (held === lock.token) {
    removeEntry({ path: lock.path });
  }
}

/**
 * The production liveness check: signal 0 asks the kernel without delivering anything.
 *
 * @param pid the lock holder's pid
 * @returns whether it is running, or running under another user
 */
export function processPidAlive({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return isRecord(error) && error["code"] === "EPERM";
  }
}

/** Take the lock, mapping a refusal into the store's errors. */
function takeLock({
  path,
  pidAlive,
}: {
  path: string;
  pidAlive: PidAlive;
}): Result<PrivateTermsLock, PrivateTermsStoreError> {
  return takePrivateTermsLock({ path, pidAlive }).mapErr((refusal) => {
    if (refusal.kind === "held") {
      return PrivateTermsStoreErrors.lockHeld({ path, why: refusal.why });
    }
    return PrivateTermsStoreErrors.ioFailed({ cause: refusal.cause, path, what: "taking the lock" });
  });
}

/**
 * Run one store change holding the terms file's lock, releasing it however the change ends. Every proposal and answer
 * the change trusts is read inside `run`, AFTER the lock is taken, because a confirm, an answer or a retire that held
 * the lock first may have changed them.
 *
 * @param home the state home whose terms file is locked
 * @param pidAlive whether a holder's pid still runs
 * @param run the change, given the terms file's path
 * @returns what the change returned, or why the lock was not taken
 */
export function underTermsLock<T>({
  home,
  pidAlive,
  run,
}: {
  home: string;
  pidAlive: PidAlive;
  run: (input: { readonly path: string }) => Result<T, PrivateTermsStoreError>;
}): Result<T, PrivateTermsStoreError> {
  const path = stateHomePaths({ home }).privateTerms;
  const directory = dirname(path);
  try {
    ensureDirectory({ directory, mode: 0o700 });
  } catch (error: unknown) {
    return err(PrivateTermsStoreErrors.ioFailed({ cause: error, path: directory, what: "making the directory" }));
  }
  const locked = takeLock({ path: `${path}.lock`, pidAlive });
  if (locked.isErr()) {
    return err(locked.error);
  }
  try {
    return run({ path });
  } finally {
    releasePrivateTermsLock({ lock: locked.value });
  }
}
