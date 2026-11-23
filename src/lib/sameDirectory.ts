/**
 * Do two paths name the same directory once the filesystem has had its say?
 *
 * A registration records the path a workspace was OPENED at, and cmux reports that same spelling back. Node's
 * `process.cwd()` does not: it is `getcwd(3)`, which answers the PHYSICAL path, so a process started under a
 * symlinked parent sees a different string for the same directory. Measured, when
 * `.claude/worktrees` became a symlink to `.claude/worktrees.noindex`: `recipe scheduler-ready` refused its own
 * scheduler on a cwd that was, byte for byte, the registered one behind the link. A string comparison of two
 * directory paths is therefore wrong whenever either side may have come from the kernel.
 *
 * Two folds, in order. `realpathSync` first, because it is the kernel's own answer and follows EVERY link in
 * the path — a child worktree nested three `.claude/worktrees` deep resolves all three, where the lexical key
 * alone folds only the first. Then `worktreePathKey` (`../worktree/location.ts`), which is what a path that
 * does not exist yet still gets: the alias folded, `/private` stripped, `..` resolved.
 */
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { worktreePathKey } from "../worktree/location.js";

/**
 * The real path of `path`; for one that does not exist or cannot be searched, the real path of its nearest ancestor
 * that can, with the rest appended as spelled — so a deleted directory under a symlinked root still keys under that
 * root. `path` itself when no ancestor resolves.
 *
 * @returns the resolved path
 */
function realOrSelf({ path }: { readonly path: string }): string {
  const tail: string[] = [];
  let probe = resolve(path);
  for (;;) {
    try {
      return join(realpathSync(probe), ...tail);
    } catch {
      const parent = dirname(probe);
      if (parent === probe) {
        return path;
      }
      tail.unshift(basename(probe));
      probe = parent;
    }
  }
}

/**
 * The key two spellings of one directory share: its real path with the worktrees alias folded, or the folded path
 * itself when it does not exist. A path under a directory keys under that directory's key, symlinked or not.
 *
 * @param path a directory path, as recorded or as reported
 * @returns the comparable key
 */
export function directoryKey({ path }: { readonly path: string }): string {
  return worktreePathKey({ path: realOrSelf({ path }) });
}

/**
 * Whether `left` and `right` resolve to the same directory, following symlinks on both sides and folding the
 * worktrees alias for a path that does not exist. Two missing paths are the same only when their keys agree.
 *
 * @param left one directory path
 * @param right the other directory path
 * @returns true when both name one directory
 */
export function sameDirectory({ left, right }: { readonly left: string; readonly right: string }): boolean {
  return directoryKey({ path: left }) === directoryKey({ path: right });
}
