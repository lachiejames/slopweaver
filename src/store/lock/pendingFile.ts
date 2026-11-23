/**
 * The lock's pending-password file and the durability it needs: a minted login password is parked here between its
 * mint and its write into `secrets/store-url`, so a run killed in between leaves the role's password in a file the
 * next run reads rather than in neither. Every write and the directories above it are fsynced before the role is
 * touched. Split from `src/cli/commands/store/lockRun.ts`, the verb shell that wires these into the lock's effects.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../../stateHome.js";
import { type StoreLockError, StoreLockErrors } from "./errors.js";

/**
 * Where an interrupted run's minted password waits — one file per stack, so a run on another stack sharing the home
 * never adopts or clears it. The stack's id is percent-encoded, so no id names another path.
 *
 * @param home the Slopweaver home
 * @param projectId the stack's `project_id`
 * @returns the file's path
 */
export function pendingPath({ home, projectId }: { home: string; projectId: string }): string {
  return join(stateHomePaths({ home }).storeLockDir, `pending-login-${encodeURIComponent(projectId)}`);
}

/**
 * Write the pending password at its own path and nowhere else: an exclusive `0600` create, synced, never the atomic
 * writer's staging sibling — a process killed between that sibling's write and its rename would leave the password in
 * a file nothing reads or removes. A kill mid-write here leaves a truncated file at the one
 * path, which logs in as nothing and is replaced by the next mint. `wx` refuses any entry at the path, a planted
 * symlink included, so nothing is written through a link. The file and EVERY directory above its real path, to the
 * filesystem root, are fsynced before this returns — never only the ones this call created, because a directory an
 * earlier killed run created is visible yet may not be durable — so the role is never changed
 * while the only copy of its new password could still vanish on a power loss. A failed sync THROWS, before the role
 * is touched.
 *
 * On macOS a bare `fsync(2)` does not flush the drive's cache, so it would not order this write ahead of the role
 * change across a power loss. Node's `fsyncSync` is libuv's `uv__fs_fsync`, which on Apple issues `F_FULLFSYNC` and
 * falls back to `F_BARRIERFSYNC`, then `fsync`, only where the filesystem refuses it (libuv `src/unix/fs.c`).
 * MEASURED, libuv 1.52.1 on APFS: a 64-byte write's `fsyncSync` took a median 1.9 ms over 20, the cost
 * of a cache flush, where a bare `fsync` returns in microseconds. Repro, run from a scratch directory:
 * `node -e 'const fs=require("fs"),fd=fs.openSync("p","w"),t=[];for(let i=0;i<20;i++){fs.writeSync(fd,"x".repeat(64));const s=process.hrtime.bigint();fs.fsyncSync(fd);t.push(Number(process.hrtime.bigint()-s)/1e6)}fs.rmSync("p");console.log(t.sort((a,b)=>a-b)[10])'`.
 *
 * @param path the pending file, under `$SLOPWEAVER_HOME/store-lock`
 * @param password the minted password it parks
 */
export function writePendingInPlace({ path, password }: { path: string; password: string }): void {
  mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  rmSync(path, { force: true });
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, `${password}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  for (const dir of ancestorsOf({ path: realpathSync(path) })) syncDirectory({ dir });
}

/**
 * Make a parked password already on disk durable without rewriting it: the file and EVERY directory above it, up to
 * the filesystem root, are fsynced. A run killed after `writePendingInPlace` fsynced the file but before its directory
 * sync leaves a password the next run can read and reuse while its entry could still vanish on a power loss, and that
 * writer may have created any number of the home's ancestors, so nothing short of the whole chain is known to cover
 * them. A failed sync THROWS, before the role is touched.
 *
 * @param path the pending file, under `$SLOPWEAVER_HOME/store-lock`
 */
export function syncPendingInPlace({ path }: { path: string }): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  for (const dir of ancestorsOf({ path: realpathSync(path) })) syncDirectory({ dir });
}

/**
 * Every directory above a path, deepest first, through the filesystem root.
 *
 * @param path an absolute file path
 * @returns its parent, that directory's parent, and so on to the root
 */
export function ancestorsOf({ path }: { path: string }): readonly string[] {
  const dirs: string[] = [];
  let current = dirname(path);
  dirs.push(current);
  while (dirname(current) !== current) {
    current = dirname(current);
    dirs.push(current);
  }
  return dirs;
}

/**
 * Make `store-url`'s directory entries durable before the run deletes the pending copy: the atomic writer syncs
 * `secrets/` itself, but this or an earlier killed run may have CREATED `secrets/` (or the home above it), and each
 * such entry lives in its parent. A power loss that kept the pending deletion and lost an unsynced entry would leave
 * the role's password in neither file, so every directory above the file's real path is synced.
 *
 * @param path the `store-url` path the secret writer reported
 * @returns ok once every directory above it is synced, or the step that failed
 */
export function syncSecretsChain({ path }: { path: string }): Result<undefined, StoreLockError> {
  try {
    for (const dir of ancestorsOf({ path: realpathSync(path) })) syncDirectory({ dir });
    return ok(undefined);
  } catch (cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return err(StoreLockErrors.secretWriteFailed({ reasons: [`syncing store-url's directories: ${why}`] }));
  }
}

/**
 * Remove a stack's parked password and make the removal durable.
 *
 * @param home the Slopweaver home
 * @param projectId the stack's `project_id`
 */
export function clearPendingInPlace({ home, projectId }: { home: string; projectId: string }): void {
  const path = pendingPath({ home, projectId });
  rmSync(path, { force: true });
  syncDirectory({ dir: dirname(path) });
}

/**
 * Fsync one directory so the entries it gained survive a power loss.
 *
 * @param dir the directory whose entries are made durable
 */
function syncDirectory({ dir }: { dir: string }): void {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
