/**
 * The lock one worktree PATH's creation holds, from its "nothing is at this path" check through `git worktree add`,
 * the checkout and the cleanup of a failure (`../cmux/worktree.ts`'s `createWorktree`).
 *
 * A failed add's cleanup removes the path recursively and drops git's registration of it. Unordered against a
 * second add of the same path, it removed whatever the SECOND add had registered there in the meantime, linked
 * worktree, `node_modules` and all. The deps lock (`./depsLock.ts`) cannot order
 * that: it lives in a worktree's own git directory, which the second add has only just made. This lock lives in the
 * repository's COMMON git directory, keyed by the path, so it exists before either add does, and two creations of
 * one path never overlap: the second refuses rather than wait behind a checkout that may run ten minutes. A
 * provision that REUSES the tree a creation registered never takes this lock — it is ordered against the
 * cleanup by the deps lock instead (`./depsLock.ts`'s `cleanUpUnlessHeld`). Two REPOSITORIES creating one physical
 * path take two of these locks; that case is safe because a cleanup of a tree that never registered removes nothing
 * a tree could hold.
 *
 * What the key does not fold: a darwin firmlink spelling (`/System/Volumes/Data/...`)
 * and a Unicode normalisation difference (NFC against NFD) each name one directory two ways under two locks.
 * Closing them needs a key from the filesystem's own identity for the path rather than from any spelling of it.
 */
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { acquireOperationLock } from "../admit/operationLock.js";
import { err, ok, type Result } from "../lib/result.js";
import { worktreePathKey } from "./location.js";

/**
 * The PHYSICAL spelling of a path that may not exist yet: its nearest existing ancestor resolved through every
 * symlink, with the rest appended, then case-folded. {@link worktreePathKey} alone is lexical, so a repository
 * reached through a symlinked root named one directory two ways and two creations of it took two locks. The fold is because darwin's default volume is case-insensitive and `realpathSync`
 * keeps the spelling it was given, so `Foo` and `foo` were one directory under two locks; on a case-sensitive volume it only makes two creations differing in case refuse each other.
 *
 * @param path any spelling of the path
 * @returns the physical spelling, folded by {@link worktreePathKey} and to lower case
 */
export function physicalPathKey({ path }: { path: string }): string {
  let ancestor = resolve(path);
  const rest: string[] = [];
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) {
    rest.unshift(basename(ancestor));
    ancestor = dirname(ancestor);
  }
  return worktreePathKey({ path: join(realpathSync(ancestor), ...rest) }).toLowerCase();
}

/**
 * Run `act` holding the add lock of `path`, or refuse at once when another creation of it holds the lock.
 *
 * The lease never goes stale while its holder lives, since a checkout may run ten minutes; a dead holder is still
 * taken over on its pid and start stamp. The key is {@link physicalPathKey} and the root the common git directory's
 * real path, so every spelling of one path, through any symlink and in any case, is one lock.
 *
 * @param gitCommonDir the repository's common git directory, which every worktree of it shares
 * @param path the worktree path being created
 * @param act the creation, run at most once; a throw from it propagates after the lock is released
 * @returns what `act` returned, or why another creation of `path` holds the lock
 */
export function withWorktreeAddLock<T>({
  gitCommonDir,
  path,
  act,
}: {
  gitCommonDir: string;
  path: string;
  act: () => T;
}): Result<T, string> {
  const lock = acquireOperationLock({
    home: join(realpathSync(gitCommonDir), "slopweaver"),
    key: `worktree-add ${physicalPathKey({ path })}`,
    nowIso: new Date().toISOString(),
    staleAfterMs: Number.POSITIVE_INFINITY,
  });
  if (lock.isErr()) {
    return err(`another creation of the worktree at ${path} is in flight, so this one was not started: ${lock.error}`);
  }
  try {
    return ok(act());
  } finally {
    lock.value.release();
  }
}
