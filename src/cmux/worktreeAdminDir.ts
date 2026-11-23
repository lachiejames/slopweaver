/**
 * The direct removal of one worktree's admin directory that `./worktree.ts`'s failed-add cleanup falls back on —
 * here rather than in that file, which is past the size ratchet, and needing no git at all once handed the
 * repository's common git directory.
 */
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Remove the one worktree admin directory under `.git/worktrees/` whose recorded `gitdir` still points at
 * `path`'s `.git`, by reading and deleting it directly — never by asking `git worktree prune` to, per
 * `./worktree.ts`'s header (the fourth discovery): a `prune` call measurably left this exact entry behind on a CI
 * runner's own git build, on every one of several retries. Idempotent and harmless when nothing matches.
 *
 * Best-effort like the rest of cleanup: a directory that cannot be listed or removed is left for the next
 * retry, never turned into a new error on top of the add's own.
 *
 * @param gitCommonDir the repository's common git directory, whose `worktrees/` holds the admin directories
 * @param path the worktree path whose registration to remove
 */
export function removeDanglingWorktreeAdminDir({ gitCommonDir, path }: { gitCommonDir: string; path: string }): void {
  const worktreesDir = join(gitCommonDir, "worktrees");
  let entries: readonly string[];
  try {
    entries = readdirSync(worktreesDir);
  } catch {
    return;
  }
  const wantedGitFile = resolve(path, ".git");
  for (const entry of entries) {
    let recorded: string;
    try {
      recorded = readFileSync(join(worktreesDir, entry, "gitdir"), "utf8").trim();
    } catch {
      continue;
    }
    if (resolve(recorded) === wantedGitFile) {
      try {
        rmSync(join(worktreesDir, entry), { force: true, recursive: true });
      } catch {
        // Best-effort — same contract as the rest of cleanup.
      }
    }
  }
}
