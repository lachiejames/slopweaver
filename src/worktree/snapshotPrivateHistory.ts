/**
 * What a one-off snapshot's PRIVATE gitdir still names, read before its removal deletes that gitdir. Split from
 * `./freshSnapshotPath.ts`, which judges what the snapshot froze: this judges what was done in it since.
 */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import type { GitRunner } from "./pruneGit.js";

/** The ref namespaces git keeps per worktree, in that worktree's own gitdir, so its removal deletes them. */
const PER_WORKTREE_REFS = ["refs/bisect/", "refs/worktree/", "refs/rewritten/"] as const;

/** Every object id written out in text, sha-1 or sha-256, in either case: git accepts an uppercase one. */
const OBJECT_ID = /\b(?:[0-9a-f]{64}|[0-9a-f]{40})\b/giu;

/** The id git writes for "no object" — a reflog's creation or deletion side. */
const NULL_OID = /^0+$/u;

/**
 * Every file `git worktree add --detach` and one commit leave in a tree's private gitdir, and nothing else. Measured
 * across all 31 live snapshots, each holding exactly these six:
 * `find "$(git rev-parse --git-common-dir)/worktrees" -type f` over the gitdirs whose `gitdir` file names a
 * `slopweaver-snap-` path. Any other file — sequencer state, a pseudo-ref, a per-worktree ref, `FETCH_HEAD`,
 * `config.worktree` — is someone's work in the tree.
 */
const SNAPSHOT_GITDIR_FILES: ReadonlySet<string> = new Set([
  "HEAD",
  "ORIG_HEAD",
  "commondir",
  "gitdir",
  "index",
  "logs/HEAD",
]);

/**
 * The tree's own gitdir, or null when it cannot be read or is the repository's shared one — a main checkout's,
 * whose files are not the tree's alone and do not go with it.
 *
 * @param git how to run git
 * @param path the tree
 * @returns the absolute private gitdir, and the repository's shared one
 */
function privateGitDir({ git, path }: { git: GitRunner; path: string }): { gitDir: string; common: string } | null {
  // Read untrimmed, git's one newline stripped: a path may end in a space, and a trimmed one names another
  // directory, where no grafts file is found.
  const gitDir = git({ args: ["rev-parse", "--absolute-git-dir"], cwd: path, untrimmed: true })?.replace(/\n$/u, "");
  const common = git({
    args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    cwd: path,
    untrimmed: true,
  })?.replace(/\n$/u, "");
  if (gitDir == null || gitDir === "" || common == null || common === "" || gitDir === common) {
    return null;
  }
  return { common, gitDir };
}

/**
 * Whether the repository rewrites its history anywhere: a `refs/replace/` ref, or an `info/grafts` file.
 *
 * Either makes two honest walks disagree about a commit's parents. The ancestry read runs with both off
 * (`--no-replace-objects` here, `GIT_GRAFT_FILE` in `./pruneGit.ts`), while `git gc` honours a grafts file, so a
 * commit the read calls contained could still be pruned once the gitdir naming it is gone.
 * No snapshot's repository needs either, so any one refuses rather than choosing which history to believe.
 *
 * @param git how to run git
 * @param path the tree
 * @param common the repository's shared gitdir, where a grafts file lives
 * @returns true when a rewrite is present or the replace refs cannot be read
 */
function historyRewritten({ git, path, common }: { git: GitRunner; path: string; common: string }): boolean {
  const replaced = git({ args: ["for-each-ref", "--format=%(refname)", "refs/replace/"], cwd: path });
  return replaced !== "" || graftsFileMayExist({ common });
}

/**
 * Whether a grafts file may sit in the shared gitdir. Only a missing path reads as none: an unreadable directory
 * hides one that `git gc` run with other permissions would still honour, so it counts.
 *
 * @param common the repository's shared gitdir
 * @returns false only when the path is known not to exist
 */
function graftsFileMayExist({ common }: { common: string }): boolean {
  try {
    lstatSync(join(common, "info", "grafts"));
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ENOENT");
  }
}

/**
 * Every object id the private gitdir's text files write out, or null when one could not be read or the gitdir
 * holds any file a snapshot's own creation does not write.
 *
 * The file set is an allowlist because reading what other files say could never be complete: each narrower read
 * lost a commit in turn — `reflog show` prints only the side a ref moved TO, `rev-parse`
 * reads only a `FETCH_HEAD`'s first line, and sequencer state names a commit abbreviated or in uppercase. Within
 * the six allowed files every id is read, both reflog sides included. The index alone is skipped, by name: it is
 * binary and names blobs the dirty-tree checks already judge, while any other file holding a NUL is no snapshot's
 * own and refuses. Anything that is not a regular file — a directory aside — refuses.
 *
 * @param gitDir the tree's own gitdir, never the shared one
 * @returns each id named, the null id aside
 */
function writtenObjects({ gitDir }: { gitDir: string }): readonly string[] | null {
  const ids: string[] = [];
  try {
    const entries = readdirSync(gitDir, { recursive: true, withFileTypes: true });
    const files = entries.filter((entry) => !entry.isDirectory());
    for (const entry of files) {
      const name = relative(gitDir, join(entry.parentPath, entry.name));
      if (!entry.isFile() || !SNAPSHOT_GITDIR_FILES.has(name)) {
        return null;
      }
      // Skipped by NAME, never by content: a NUL anywhere else is no snapshot's, so it refuses.
      if (name !== "index") {
        const text = readFileSync(join(entry.parentPath, entry.name), "utf8");
        if (text.includes("\0")) {
          return null;
        }
        for (const match of text.matchAll(OBJECT_ID)) {
          ids.push(match[0].toLowerCase());
        }
      }
    }
  } catch {
    return null;
  }
  return ids.filter((id) => !NULL_OID.test(id));
}

/**
 * Every object the tree's private gitdir names, or null when one of them could not be read.
 *
 * @param git how to run git
 * @param path the tree whose private gitdir is read
 * @param rev the commit the index must match exactly
 * @returns every id its text files write out, and the per-worktree refs' targets, deduplicated
 */
function privateNames({ git, path, rev }: { git: GitRunner; path: string; rev: string }): ReadonlySet<string> | null {
  const dirs = privateGitDir({ git, path });
  if (dirs === null || historyRewritten({ common: dirs.common, git, path })) {
    return null;
  }
  const written = writtenObjects({ gitDir: dirs.gitDir });
  // Belt to the file scan's braces: git's own answer for the refs whose removal goes with the tree.
  const refs = git({ args: ["for-each-ref", "--format=%(objectname)", ...PER_WORKTREE_REFS], cwd: path });
  // The index is skipped as binary, so it is read whole here instead: its entries must be `rev`'s own, a blob staged
  // since standing on nothing else, and its resolve-undo record must be empty, since that
  // keeps a resolved conflict's sides there and nowhere else.
  // A submodule's `ignore=all` config would otherwise hide a staged gitlink.
  const staged = git({ args: ["diff-index", "--cached", "--quiet", "--ignore-submodules=none", rev, "--"], cwd: path });
  const resolveUndo = git({ args: ["ls-files", "--resolve-undo"], cwd: path });
  if (written === null || refs === null || staged !== "" || resolveUndo !== "") {
    return null;
  }
  return new Set([...written, ...refs.split("\n")].filter((line) => line !== ""));
}

/**
 * Whether everything the tree's private gitdir names is `rev` or an ancestor of it, so the removal, which deletes
 * that gitdir, takes no commit with it.
 *
 * Its reflogs, per-worktree refs, pseudo-refs and sequencer state all go with the tree, and a commit made onto a
 * snapshot and moved away from survives in any of them and nowhere else. A snapshot's
 * own creation names only its HEAD and its parent, so a real one passes. Anything unreadable refuses, as does an
 * index whose entries are not `rev`'s, and so does
 * any id that is not a commit HEAD contains — a tree, a blob, a tag, an object that does not exist — and any
 * repository that rewrites its history, whose parents `git gc` may read differently from this check. Each id is
 * read with replacement refs off, and its type before its ancestry, since `merge-base` peels a tag.
 *
 * @param git how to run git
 * @param path the snapshot's worktree
 * @param rev the commit every private name must be contained in
 * @returns true only when nothing the private gitdir names is outside `rev`'s history
 */
export function privateHistoryWithinHead({ git, path, rev }: { git: GitRunner; path: string; rev: string }): boolean {
  const names = privateNames({ git, path, rev });
  if (names === null) {
    return false;
  }
  return [...names].every(
    (sha) =>
      // `merge-base` peels a tag to its commit, so the object's own type is read first.
      git({ args: ["--no-replace-objects", "cat-file", "-t", sha], cwd: path }) === "commit" &&
      git({ args: ["--no-replace-objects", "merge-base", "--is-ancestor", sha, rev], cwd: path }) !== null,
  );
}
