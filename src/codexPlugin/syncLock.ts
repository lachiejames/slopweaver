/**
 * The plugin-sync lock `./sync.ts`'s `performFleetSync` holds while it exports and re-adds into every home: an operation lock in the
 * export root, plus the empty `sync.lock` directory an earlier build took, honoured only while it may still be live.
 */
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { acquireOperationLockDetailed, type OperationLockHandle } from "../admit/operationLock.js";
import { operationLockPath } from "../admit/operationLockPath.js";

import { STEP_TIMEOUT_MS } from "./checkout.js";
import { type CodexPluginSyncError, CodexPluginSyncErrors } from "./errors.js";
import type { SyncOutcome } from "./plan.js";

/**
 * The key of the one plugin-sync lock, an operation lock (`../admit/operationLock.ts`) in the export root. It is
 * never stale while its holder lives: a dead or zombie holder is recovered at once by the one liveness check every
 * lock reads (`../talk/relayLease.ts`'s `processStartOf`), and a live one is never broken because the clock moved.
 */
const SYNC_LOCK_KEY = "codex-plugin-sync";

/**
 * The lock an earlier build took: an empty `sync.lock` directory, judged by its mtime alone. Nothing writes one now;
 * it is read only so a run of that build still in flight keeps the export to itself; one it left is ignored.
 */
const DIRECTORY_LOCK_NAME = "sync.lock";

/**
 * How old an earlier build's `sync.lock` must be to be a dead holder's — the bound that build broke it at: the three
 * timed steps (archive, extract, add) plus one of slack. The residue is an earlier build starting between this check
 * and the operation lock, which no check can close while the two take different names.
 */
const DIRECTORY_LOCK_STALE_MS = 4 * STEP_TIMEOUT_MS;

/**
 * Whether an earlier build's `sync.lock` still keeps the export (`busy`), or there is none now (`clear`) — one older
 * than {@link DIRECTORY_LOCK_STALE_MS} is ignored and left where it is, never removed: an earlier build still running
 * breaks a stale one itself and takes it in the same step, so removing it here could remove that build's live lock
 * A path that cannot be read, or is not the empty directory that build made, is refused rather than
 * either waited on or removed.
 *
 * @param exportRoot the directory the earlier build's lock sat in
 * @param nowMs the instant its age is judged at
 * @returns `clear` or `busy`, or why that path could not be judged
 */
function directorySyncLock({
  exportRoot,
  nowMs,
}: {
  exportRoot: string;
  nowMs: number;
}): Result<"busy" | "clear", CodexPluginSyncError> {
  const directoryLock = join(exportRoot, DIRECTORY_LOCK_NAME);
  try {
    const found = lstatSync(directoryLock, { throwIfNoEntry: false });
    if (found === undefined) {
      return ok("clear");
    }
    if (!found.isDirectory() || readdirSync(directoryLock).length > 0) {
      return err(
        CodexPluginSyncErrors.syncLockUnavailable({
          detail: `${directoryLock} is not the empty directory an earlier build's lock was — move it aside and re-run`,
        }),
      );
    }
    // A lock dated in the future was not just taken by a run of that build, whose own clock this one shares, so it is
    // ignored like a stale one rather than waited on for as long as the clock lags.
    const ageMs = nowMs - found.mtimeMs;
    if (ageMs >= 0 && ageMs <= DIRECTORY_LOCK_STALE_MS) {
      return ok("busy");
    }
    return ok("clear");
  } catch (error: unknown) {
    return err(
      CodexPluginSyncErrors.syncLockUnavailable({
        detail: `the earlier build's lock ${directoryLock} could not be judged: ${errorMessage({ error })}`,
      }),
    );
  }
}

/**
 * Take the plugin-sync lock: the earlier build's directory lock judged first, then the never-stale operation lock.
 *
 * @param paths the export root the lock lives in
 * @param nowMs the instant of the attempt
 * @returns the handle releasing it, or the outcome to report — `busy` only while another run holds it
 */
export function takeSyncLock({
  paths,
  nowMs,
}: {
  paths: { readonly exportRoot: string };
  nowMs: number;
}): Result<OperationLockHandle, SyncOutcome> {
  const directoryLock = directorySyncLock({ exportRoot: paths.exportRoot, nowMs });
  if (directoryLock.isErr()) {
    return err({ did: "failed", error: directoryLock.error });
  }
  if (directoryLock.value === "busy") {
    return err({
      did: "busy",
      why: `an earlier build's plugin-sync holds ${join(paths.exportRoot, DIRECTORY_LOCK_NAME)}`,
    });
  }
  const lock = acquireOperationLockDetailed({
    directory: paths.exportRoot,
    home: paths.exportRoot,
    key: SYNC_LOCK_KEY,
    nowIso: new Date(nowMs).toISOString(),
    staleAfterMs: Number.POSITIVE_INFINITY,
  });
  if (lock.isOk()) {
    return ok(lock.value);
  }
  if (lock.error.code === "LOCK_CONTENDED") {
    return err({ did: "busy", why: `another plugin-sync holds ${syncLockPath({ paths })}: ${lock.error.message}` });
  }
  return err({ did: "failed", error: CodexPluginSyncErrors.syncLockUnavailable({ detail: lock.error.message }) });
}

/**
 * Where the plugin-sync lock lives.
 *
 * @param paths the export root the lock lives in
 * @returns the operation lock's directory in the export root
 */
export function syncLockPath({ paths }: { paths: { readonly exportRoot: string } }): string {
  return operationLockPath({ directory: paths.exportRoot, home: paths.exportRoot, key: SYNC_LOCK_KEY });
}
