/**
 * Paths git has been told to stop watching, and what they are on disk: the half of a tree fingerprint that
 * `git diff` cannot see, split out of {@link ./gitDiff} so that file keeps to the diff capture itself.
 *
 * Every git command here runs through {@link ./gitRun}'s runner and only ever reads.
 */

import { lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { runGitChecked } from "./gitRun.js";

/** {@link runGitChecked} under the short name this module's own reads use; none of them adds to the env. */
const runGit = runGitChecked;

/**
 * Paths git has been told to stop watching.
 *
 * `git ls-files -v` prefixes each path with a status letter, and a LOWERCASE letter means the entry is
 * assume-unchanged; `S` means skip-worktree. Either way git suppresses that file from `git diff`, so any
 * fingerprint taken over a diff is blind to it. Read NUL-separated, so no path can split a record.
 *
 * @param cwd the repository to inspect
 * @returns the affected paths, empty when the tree is honestly diffable
 */
export function assumeUnchangedPaths({ cwd }: { cwd: string }): readonly string[] {
  const listed = runGit({ args: ["ls-files", "-v", "-z"], cwd, label: "git ls-files -v" });
  return listed
    .split("\0")
    .filter((entry) => /^[a-z]/.test(entry) || entry.startsWith("S "))
    .map((entry) => entry.slice(2));
}

/** How many paths one `git hash-object` invocation is given, so a sparse checkout cannot overrun argv. */
const HASH_OBJECT_CHUNK = 200;

/**
 * One line per hidden path whose working-tree content is not HEAD's, so an edit git will not report still
 * moves the fingerprint.
 *
 * Content is compared by BLOB ID: `git hash-object -- <path>` applies the same attributes and clean filters
 * `git add` would, so an untouched file hashes to exactly the committed blob even under line-ending
 * conversion. A marked path whose content equals HEAD contributes NOTHING — the digest of a marked,
 * untouched tree is the digest of the same tree unmarked, which is what keeps a skip-worktree flag the whole
 * fleet sets from reading as a change. A symlink is compared by its target, because `hash-object` follows
 * links; a path absent from disk, or a directory where HEAD holds a submodule, is named as such.
 *
 * @param cwd the repository root
 * @param paths the assume-unchanged / skip-worktree paths
 * @returns the lines, sorted by path, or an empty string when every hidden path matches HEAD
 */
export function hiddenPathsText({ cwd, paths }: { cwd: string; paths: readonly string[] }): string {
  if (paths.length === 0) {
    return "";
  }
  const committed = headEntries({ cwd, paths: new Set(paths) });
  const identity = worktreeIdentities({ cwd, paths });
  const lines: string[] = [];
  for (const path of paths.toSorted()) {
    const head = committed.get(path);
    const worktree = identity.get(path)!;
    if (!matchesHead({ cwd, head, worktree })) {
      const committedAs = head === undefined ? "absent" : `${head.mode} ${head.sha}`;
      lines.push(`hidden ${path} head=${committedAs} worktree=${worktree}`);
    }
  }
  return lines.join("\n");
}

/**
 * What each hidden path is on disk: git's file mode and blob id for a regular file, a symlink target, or a named
 * absence. The mode is part of it because `git diff` reports an executable-bit flip on identical content.
 *
 * @param cwd the repository root
 * @param paths the hidden paths
 * @returns one identity per path, comparable by {@link matchesHead}
 */
function worktreeIdentities({ cwd, paths }: { cwd: string; paths: readonly string[] }): Map<string, string> {
  const regular: { path: string; mode: string }[] = [];
  const identity = new Map<string, string>();
  for (const path of paths) {
    const stat = lstatSync(join(cwd, path), { throwIfNoEntry: false });
    if (stat === undefined) {
      identity.set(path, "absent");
    } else if (stat.isSymbolicLink()) {
      identity.set(path, `symlink:${readlinkSync(join(cwd, path))}`);
    } else if (stat.isFile()) {
      regular.push({ mode: (stat.mode & 0o111) === 0 ? "100644" : "100755", path });
    } else {
      identity.set(path, "not-a-file");
    }
  }
  for (let i = 0; i < regular.length; i += HASH_OBJECT_CHUNK) {
    const chunk = regular.slice(i, i + HASH_OBJECT_CHUNK);
    const shas = runGit({
      args: ["hash-object", "--", ...chunk.map((file) => file.path)],
      cwd,
      label: "git hash-object",
    })
      .trim()
      .split("\n");
    chunk.forEach((file, index) => identity.set(file.path, `${file.mode} ${shas[index]!}`));
  }
  return identity;
}

/**
 * HEAD's mode and blob for each of the given paths, from one full listing of the committed tree.
 *
 * @param cwd the repository root
 * @param paths the paths to keep; everything else in the listing is dropped
 * @returns the committed entry per path; a path HEAD does not hold is simply missing
 */
function headEntries({
  cwd,
  paths,
}: {
  cwd: string;
  paths: ReadonlySet<string>;
}): Map<string, { mode: string; sha: string }> {
  const listed = runGit({ args: ["ls-tree", "-r", "-z", "--full-tree", "HEAD"], cwd, label: "git ls-tree HEAD" });
  const entries = new Map<string, { mode: string; sha: string }>();
  for (const record of listed.split("\0")) {
    const tab = record.indexOf("\t");
    const path = record.slice(tab + 1);
    if (tab < 0 || !paths.has(path)) {
      continue;
    }
    const [mode, , sha] = record.slice(0, tab).split(" ");
    entries.set(path, { mode: mode!, sha: sha! });
  }
  return entries;
}

/**
 * Whether a hidden path's working-tree identity is exactly what HEAD commits.
 *
 * @param cwd the repository root, needed to read a committed symlink's target
 * @param head the committed entry, or undefined when HEAD does not hold the path
 * @param worktree the identity {@link hiddenPathsText} derived from disk
 * @returns true only when nothing about the path differs from HEAD
 */
function matchesHead({
  cwd,
  head,
  worktree,
}: {
  cwd: string;
  head: { mode: string; sha: string } | undefined;
  worktree: string;
}): boolean {
  if (head === undefined) {
    return false;
  }
  if (head.mode === "120000") {
    const target = runGit({ args: ["cat-file", "blob", head.sha], cwd, label: "git cat-file blob" });
    return worktree === `symlink:${target}`;
  }
  return worktree === `${head.mode} ${head.sha}`;
}
