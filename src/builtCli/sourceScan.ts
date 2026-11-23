/**
 * The source listing both halves of the built CLI rest on: the emit reads it to decide what to compile, and
 * the staleness guard stamps it to decide whether that compile still describes the tree.
 *
 * One module rather than two ON PURPOSE. If the guard stamped a listing the emit did not read, a file
 * outside the intersection would be either invisible to the guard (stale builds pass) or permanently
 * different (every build reads stale). The single function is what makes the two answers about the same set.
 *
 * Effectful shell: at most one `git ls-files` spawn (none while the index is unchanged) and one `statSync` per
 * file. The comparison it feeds is pure and lives in {@link ./staleness}.
 */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import { cachedListing } from "./listingCache.js";
import type { SourceStamp } from "./staleness.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/** The source tree the emit reads and the guard stamps, relative to the repository root. */
export const SOURCE_ROOT = "src";

/**
 * Every source file the emit reads — the whole `src` tree minus its test lane.
 *
 * Asked of git rather than of a directory walk so an ignored scratch file, a stale editor backup and an
 * untracked experiment can never reach the emitted tree.
 *
 * A `git ls-files` PATHSPEC naming a double-star glob under `src` is the spelling that looks right and quietly loses a file: git matches a
 * pathspec with FNM_PATHNAME, under which `**` spans no segment boundary, so `src/config.ts` does not match
 * and never reached the emit — the built entrypoint then died on `ERR_MODULE_NOT_FOUND` for `config.js`,
 * with a file count that looked plausible (4,093 against the real 4,158). Listing the tree and filtering
 * here is checkable; a pathspec glob is not.
 *
 * `-z`, and no trim, for the reason `workingTreeFilesOf` carries: git prints a tracked path whose name
 * begins with a space UNQUOTED, so a newline split with a `.trim()` turns ` a.ts` into `a.ts` and emits a
 * different file twice while losing the real one. Measured on the listing this reads: 4,158 either way
 * today, and the aliasing is silent the day one such path is added. Repro:
 * `git init t && cd t && printf 'x\n' > ' a' && git add -A && git ls-files | od -c | head -2`.
 *
 * The listing is git's, remembered against the index it came from (`listingCache.ts`): the guard runs on every
 * built-CLI invocation, and the spawn was most of its cost.
 *
 * @param root the repository root to list, absolute
 * @returns every repo-relative source path, in git's own order
 */
export function sourceFiles({ root }: { root: string }): readonly string[] {
  const argv = ["ls-files", "-z", SOURCE_ROOT];
  const listed = cachedListing({
    argv,
    env: process.env,
    list: () => {
      const ran = spawnSync("git", argv, {
        cwd: root,
        encoding: "utf8",
        killSignal: "SIGKILL",
        timeout: GIT_READ_TIMEOUT_MS,
      });
      // Whatever git printed is read as it always was; only a listing git stood behind (exit 0) is remembered.
      return { files: ran.stdout.split("\0"), remember: ran.status === 0 };
    },
    root,
  });
  return listed.filter((path) => path.endsWith(".ts") && !path.startsWith(`${SOURCE_ROOT}/__tests__/`));
}

/**
 * Stamp every source file with what the guard compares — its size and when it last changed.
 *
 * A file listed by git and absent from disk is SKIPPED rather than thrown on, and that is the correct arm:
 * the listing comes from the index, so a file deleted but not yet staged is exactly this case, and the
 * comparison already reports it as gone since the build.
 *
 * @param root the repository root, absolute
 * @returns one stamp per readable source file, in git's own order
 */
export function scanSourceStamps({ root }: { root: string }): readonly SourceStamp[] {
  const stamps: SourceStamp[] = [];
  for (const path of sourceFiles({ root })) {
    const stat = statSync(join(root, path), { throwIfNoEntry: false });
    if (stat !== undefined) {
      stamps.push({ mtimeMs: Math.round(stat.mtimeMs), path, size: stat.size });
    }
  }
  return stamps;
}
