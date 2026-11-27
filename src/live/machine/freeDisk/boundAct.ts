/**
 * `machine free-disk`'s two file system acts, bound to the inode the plan captured rather than to a path name.
 * A recheck and an act on a path are two system calls, so a path swapped between them would otherwise be acted
 * on. Each act therefore RENAMES first — a rename moves whatever object the name holds at that instant, atomically
 * — and then compares the moved object's device and inode with the plan's. A mismatch renames it back and refuses
 * as `PLAN_CHANGED`, so the object an act destroys or moves is always the one the plan read.
 */
import { lstatSync, mkdtempSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { type FreeDiskError, FreeDiskErrors } from "./errors.js";
import type { PathIdentity } from "./types.js";

/** Whether the object now at `path` is the one the plan captured; an unreadable path is not. */
function holdsIdentity({ path, identity }: { path: string; identity: PathIdentity }): boolean {
  try {
    const stats = lstatSync(path);
    return stats.dev === identity.dev && stats.ino === identity.ino;
  } catch {
    return false;
  }
}

/** Rename `from` to `to`, then refuse — renaming back — unless what moved is the planned object. */
function renameBound({
  from,
  to,
  identity,
}: {
  from: string;
  to: string;
  identity: PathIdentity;
}): Result<true, FreeDiskError> {
  try {
    renameSync(from, to);
  } catch (cause: unknown) {
    return err(FreeDiskErrors.applyFailed({ cause, path: from }));
  }
  if (holdsIdentity({ identity, path: to })) {
    return ok(true);
  }
  try {
    renameSync(to, from);
  } catch (cause: unknown) {
    return err(FreeDiskErrors.applyFailed({ cause, path: to }));
  }
  return err(FreeDiskErrors.planChanged({ path: from, what: "a different object took its name before the act" }));
}

/**
 * Remove a directory tree only when it is still the object the plan read: rename it into a fresh sibling
 * directory, check its device and inode there, and only then remove the sibling.
 *
 * @param identity the device and inode the plan captured for `path`
 * @returns `true` once removed, or the refusal or failure that left it in place
 */
export function removeBoundTree({
  path,
  identity,
}: {
  path: string;
  identity: PathIdentity;
}): Result<true, FreeDiskError> {
  let holding: string;
  try {
    holding = mkdtempSync(join(dirname(path), ".free-disk-"));
  } catch (cause: unknown) {
    return err(FreeDiskErrors.applyFailed({ cause, path }));
  }
  const moved = renameBound({ from: path, identity, to: join(holding, basename(path)) });
  if (moved.isErr()) {
    // rmdir only ever removes an EMPTY directory, so a failed rename back leaves the object where it is.
    try {
      rmdirSync(holding);
    } catch {
      // The holding directory stays beside the target; the refusal already names what happened.
    }
    return err(moved.error);
  }
  try {
    rmSync(holding, { force: false, recursive: true });
    return ok(true);
  } catch (cause: unknown) {
    return err(FreeDiskErrors.applyFailed({ cause, path: holding }));
  }
}

/**
 * Move an application bundle into the Trash only when it is still the object the plan read, putting it back
 * when the moved object is not.
 *
 * @param destination the Trash path the plan derived and checked free
 * @param identity the device and inode the plan captured for `source`
 * @returns `true` once moved, or the refusal or failure that left it in place
 */
export function moveBoundToTrash({
  source,
  destination,
  identity,
}: {
  source: string;
  destination: string;
  identity: PathIdentity;
}): Result<true, FreeDiskError> {
  return renameBound({ from: source, identity, to: destination });
}
