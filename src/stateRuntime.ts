/**
 * Where a home's PROCESS-LIFETIME state lives: the locks, stamps and throttles that only mean something while the
 * processes that wrote them run, and so have no business in `$SLOPWEAVER_HOME` (which is moving whole into the
 * store) or in the store itself.
 *
 * The test is the one the home-into-the-store move states: a lock moves to the OS runtime directory rather than a
 * table UNLESS its exclusion must survive the process holding it. A lock judged by its holder's pid and process
 * start (`./admit/operationLock.ts`) is exactly that kind — the instant its holder dies it is free — so it lives
 * here. A lease that must outlive its holder would be a store row with an owner, an expiry and a takeover instead.
 *
 * ## The directory
 *
 * `/tmp/slopweaver-<uid>/<home key>`, one FIXED root per user, never under `os.tmpdir()`: `TMPDIR` is whatever a
 * process inherited, and a sandboxed shell sets its own, so two processes for one home could each hold "the" lock in a
 * different directory. `XDG_RUNTIME_DIR` is not read for the same reason. `/tmp` is shared, so
 * the `slopweaver-<uid>` directory is made `0700` and REFUSED when it is not this user's own `0700` directory — another
 * user who made it first could otherwise read or plant a lock. The one override is {@link RUNTIME_ROOT_VAR}, which
 * every test lane's setup points at its own sandbox (`src/__tests__/setup-temp-root.ts`), the shape
 * `./worktree/deleteLease.ts` set.
 *
 * The home key is the first 32 hex characters of the SHA-256 of the home's real path, so two homes on one machine
 * never share a lock and two spellings of one home always do. A home whose real path cannot be read is a refusal
 * rather than a hash of whatever string arrived, which would silently split one home's locks in two.
 *
 * Losing this directory is safe by construction: a reboot or the OS's temp sweep only removes state whose writers
 * are gone. (macOS's periodic sweep of `/tmp` removes entries left untouched for days; nothing kept here is held that
 * long.)
 */
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

/** The environment variable a test lane sets to keep its runtime directories inside its own sandbox. */
export const RUNTIME_ROOT_VAR = "SLOPWEAVER_RUNTIME_ROOT";

/**
 * The directory the per-user root sits in: {@link RUNTIME_ROOT_VAR} when a test lane set it, else `/tmp`.
 *
 * The residue: two processes given DIFFERENT values each hold their own locks. That
 * takes a deliberate setting, unlike `TMPDIR`, which a sandbox sets unasked — nothing but the test lanes' setup sets
 * this variable. Closing it would mean no override at all, so tests could not keep their locks out of `/tmp`.
 *
 * @returns the parent of `slopweaver-<uid>`
 */
function runtimeParent(): string {
  const override = process.env[RUNTIME_ROOT_VAR];
  if (override !== undefined && override !== "") {
    return override;
  }
  return "/tmp";
}

/** The one way finding a home's runtime directory fails, carrying what was attempted and why it stopped. */
export interface RuntimeDirectoryError {
  readonly code: "RUNTIME_DIRECTORY_UNAVAILABLE";
  readonly message: string;
}

/**
 * The refusal, in one spelling.
 *
 * @param why what went wrong, finishing "the runtime directory is unavailable: …"
 * @returns the typed error
 */
function unavailable({ why }: { why: string }): RuntimeDirectoryError {
  return { code: "RUNTIME_DIRECTORY_UNAVAILABLE", message: `the runtime directory is unavailable: ${why}` };
}

/** Owner-only, as every directory here is. */
const DIRECTORY_MODE = 0o700;

/**
 * This user's own `slopweaver-<uid>` directory under `/tmp`, made `0700` when absent and refused when
 * it is a link, not a directory, not this user's, or open to anyone else.
 *
 * @returns the directory, or why it cannot be trusted
 */
function userRuntimeRoot(): Result<string, RuntimeDirectoryError> {
  const uid = process.getuid?.();
  if (uid === undefined) {
    return err(unavailable({ why: "this platform has no user id to key it by" }));
  }
  const root = join(runtimeParent(), `slopweaver-${String(uid)}`);
  try {
    mkdirSync(root, { mode: DIRECTORY_MODE, recursive: true });
    const stats = lstatSync(root);
    if (!stats.isDirectory()) {
      return err(unavailable({ why: `${root} is not a directory` }));
    }
    if (stats.uid !== uid) {
      return err(unavailable({ why: `${root} belongs to user ${String(stats.uid)}, not ${String(uid)}` }));
    }
    if ((stats.mode & 0o077) !== 0) {
      return err(unavailable({ why: `${root} is open to other users (mode ${(stats.mode & 0o777).toString(8)})` }));
    }
  } catch (cause) {
    return err(unavailable({ why: `${root}: ${errorMessage({ error: cause })}` }));
  }
  return ok(root);
}

/**
 * The runtime directory for one home, made owner-only when absent.
 *
 * @param home the Slopweaver home whose process-lifetime state is meant
 * @returns `/tmp/slopweaver-<uid>/<home key>`, or why it could not be made or trusted
 */
export function homeRuntimeDir({ home }: { home: string }): Result<string, RuntimeDirectoryError> {
  let real: string;
  try {
    real = realpathSync(home);
  } catch (cause) {
    return err(unavailable({ why: `the home ${home} has no real path: ${errorMessage({ error: cause })}` }));
  }
  const root = userRuntimeRoot();
  if (root.isErr()) {
    return err(root.error);
  }
  // An override inside the home would put the home's process-lifetime state back in it.
  // Measured by `relative`, never a prefix, so a home of `/` contains everything.
  const fromHome = relative(real, realpathSync(root.value));
  if (fromHome === "" || (!fromHome.startsWith("..") && !isAbsolute(fromHome))) {
    return err(unavailable({ why: `${root.value} is inside the home ${real}` }));
  }
  const directory = join(root.value, createHash("sha256").update(real, "utf8").digest("hex").slice(0, 32));
  try {
    mkdirSync(directory, { mode: DIRECTORY_MODE, recursive: true });
    // Refused when it is a link or anything but a directory, which would carry every lock to wherever it points,
    // the home included. The residue: a process of THIS user swapping the
    // directory for a link between this check and a lock's write still wins. That is out of
    // reach by construction — the `0700` root admits no other user, and this user's own processes can already write
    // the home directly — so the check stops a stale or planted link, not a racer holding the same uid.
    if (!lstatSync(directory).isDirectory()) {
      return err(unavailable({ why: `${directory} is not a directory` }));
    }
    chmodSync(directory, DIRECTORY_MODE);
  } catch (cause) {
    return err(unavailable({ why: `${directory}: ${errorMessage({ error: cause })}` }));
  }
  return ok(directory);
}

/**
 * Where a home's process-lifetime operation locks are made: `<runtime>/operation-locks`, handed to
 * `acquireOperationLock`'s `directory` (`./admit/operationLock.ts`).
 *
 * @param home the Slopweaver home
 * @returns the lock directory (made by the lock itself on first use), or why the runtime directory is unavailable
 */
export function runtimeLockDir({ home }: { home: string }): Result<string, RuntimeDirectoryError> {
  return homeRuntimeDir({ home }).map((directory) => join(directory, "operation-locks"));
}

/**
 * Where this USER's machine-wide operation locks are made: `<root>/user-locks`, one directory for every home. A lock
 * here excludes across homes, which a per-home lock cannot — the local Supabase stack is one per Docker daemon, so
 * two homes reconciling it must see one another (`./store/lock/edge.ts` `holdStackLock`).
 *
 * @returns the lock directory (made by the lock itself on first use), or why the runtime directory is unavailable
 */
export function userRuntimeLockDir(): Result<string, RuntimeDirectoryError> {
  return userRuntimeRoot().map((root) => join(root, "user-locks"));
}

/**
 * Where a home's cmux stamps are written: what the seats' calls last heard (`./cmux/insideCalls.ts`) and the dialog
 * decline's claim (`./cmux/dialogRecovery.ts`). Each only means something inside one run of the cmux app, which a
 * reboot ends with this directory.
 *
 * @param home the Slopweaver home
 * @returns `<runtime>/cmux` (made by the first writer), or why the runtime directory is unavailable
 */
export function runtimeCmuxDir({ home }: { home: string }): Result<string, RuntimeDirectoryError> {
  return homeRuntimeDir({ home }).map((directory) => join(directory, "cmux"));
}
