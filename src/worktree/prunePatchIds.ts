/**
 * Whether every commit a branch has is already in the trunk, by VERBATIM patch id.
 *
 * `git cherry` cannot answer this, because its patch ids strip whitespace: a branch committing ` x` against a trunk committing `\tx` reads as
 * absorbed, the tree goes, and the branch's exact bytes are in no commit the trunk reaches. CRLF against LF reads
 * the same way. `git patch-id --verbatim` keeps every byte, but cherry cannot be asked for it, so this file asks
 * it directly.
 *
 * ## Two phases, because the patch log is too large to hash whole
 *
 * MEASURED: on this repository a fortnight-old branch is 875 trunk commits behind, and their patch
 * log is 88 MB — past the runner's 32 MiB buffer, so hashing the whole trunk side would answer "unknown" for
 * every old tree. Reproduce: `git log -p --no-merges --binary --full-index <old-branch>..origin/main | wc -c`.
 * Cherry is cheap for the reason this copies: two patches with one verbatim id touch the same files, so a trunk
 * commit is only hashed when the SET of paths it touches equals one a branch commit touches. That listing is
 * names only, and only the few trunk commits it matches have their patches read.
 *
 * The filter can only remove trunk candidates, never add one, so it can make a branch read as unabsorbed and
 * never the reverse. Every branch commit with a path must yield an id of its own: one that yields none is read
 * as unabsorbed rather than as carrying nothing.
 *
 * ## What it still cannot see, and why that loses nothing
 *
 * A patch id ignores where a hunk lands, so a rebased commit still matches — and so does a different edit of an
 * identical block elsewhere in the same file: the r3 Codex review edited the first of two repeated blocks on the
 * branch and the second on the trunk, and both hashed alike. Absorption only decides that a CLEAN tree may go; the
 * branch ref is what keeps the commits, and it is deleted only at a tip the trunk carries, so a commit this reads
 * wrongly stays on its branch (`pruneBranchDelete.ts`'s `deleteBranchInTrunk`). Asking git to replay the patch instead
 * would run whatever merge driver the repository configures.
 */
import type { GitRunner } from "./pruneGit.js";

/**
 * The flags both phases share, so the paths one lists are the files the other's patch names.
 *
 * `--no-renames` because a rename is a delete and an add under one setting and a single entry under the other,
 * and `diff.renames` is the repository's to set.
 */
const COMMON = ["--no-merges", "--no-renames", "--no-color"] as const;

/**
 * The patch log in the one spelling whose ids a repository's config cannot collapse.
 *
 * `--no-textconv` and `--no-ext-diff` because either would hash what a configured program PRINTS rather than
 * the bytes: measured, a textconv rendering two different files identically gave them one id without the flag.
 * `--binary --full-index` because without them two different edits of one binary file both read "Binary files
 * differ" and share an id. Measured, git 2.54.0, one fixture repository per case.
 */
const PATCH_LOG = [
  "log",
  "-p",
  ...COMMON,
  "--no-ext-diff",
  "--no-textconv",
  "--full-index",
  "--binary",
  "--format=commit %H",
] as const;

/** One `git patch-id` record: the patch id, then the commit it was read from — hex of either hash length. */
const PATCH_ID_LINE = /^([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64})$/;

/** The marker a commit's sha opens with in the path listing; no path git lists can hold a NUL. */
const COMMIT_MARK = "\0";

/** A full commit sha, of either hash length. */
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Each commit's verbatim patch id, from `git patch-id` output.
 *
 * Pure, so the exact output git prints is a fixture. A line of any other shape answers `null` rather than being
 * skipped: the caller cannot tell whether the line it lost was a branch commit's.
 *
 * @param listing everything `git patch-id --verbatim` wrote to stdout
 * @returns patch id by commit sha, empty for empty output, or `null` when the output is malformed
 */
export function patchIdsIn({ listing }: { listing: string }): ReadonlyMap<string, string> | null {
  const ids = new Map<string, string>();
  for (const line of listing.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const match = PATCH_ID_LINE.exec(line.trim());
    if (match === null) {
      return null;
    }
    ids.set(match[2]!, match[1]!);
  }
  return ids;
}

/**
 * Each commit's touched paths as one key, from a `--name-only --format=%x00%H` listing.
 *
 * Pure. A commit opens with a NUL and its sha; every non-blank line after it until the next is a path, which git
 * prints quoted when it holds a control character, so a path is always one line. The key is the sorted paths
 * joined by NUL, and an empty commit's key is empty.
 *
 * @param listing everything `git log --name-only` wrote to stdout
 * @returns the key by commit sha, or `null` when a path line comes before any commit or a sha is malformed
 */
export function pathKeysIn({ listing }: { listing: string }): ReadonlyMap<string, string> | null {
  const paths = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of listing.split("\n")) {
    if (line.startsWith(COMMIT_MARK)) {
      const sha = line.slice(COMMIT_MARK.length).trim();
      if (!SHA.test(sha)) {
        return null;
      }
      current = [];
      paths.set(sha, current);
      continue;
    }
    if (line.trim().length === 0) {
      continue;
    }
    if (current === null) {
      return null;
    }
    current.push(line);
  }
  return new Map([...paths].map(([sha, list]) => [sha, list.toSorted().join(COMMIT_MARK)]));
}

/**
 * Whether every path-touching commit on the branch has its verbatim patch id among the trunk's.
 *
 * Pure: the decision {@link verbatimAbsorbed} reads its facts into. A branch commit touching no path carries no
 * byte and is passed over; one touching a path with no id of its own is unabsorbed.
 *
 * @param branchKeys each branch commit's path key
 * @param ids the verbatim patch id of each commit that was hashed, branch and trunk candidates together
 * @param trunkCandidates the trunk commits whose path key a branch commit shares
 * @returns true when every branch commit with a path is matched by a trunk candidate's id
 */
export function everyBranchPatchInTrunk({
  branchKeys,
  ids,
  trunkCandidates,
}: {
  branchKeys: ReadonlyMap<string, string>;
  ids: ReadonlyMap<string, string>;
  trunkCandidates: readonly string[];
}): boolean {
  const trunkIds = new Set(trunkCandidates.flatMap((sha) => [ids.get(sha)].filter((id) => id !== undefined)));
  return [...branchKeys].every(([sha, key]) => {
    if (key.length === 0) {
      return true;
    }
    const id = ids.get(sha);
    return id !== undefined && trunkIds.has(id);
  });
}

/**
 * Each commit's path key over a range, or `null` when git or the parse failed.
 *
 * @param git how to run git
 * @param range the revision range
 * @param repoRoot the repository to ask
 * @returns the key by commit sha
 */
function pathKeys({
  git,
  range,
  repoRoot,
}: {
  git: GitRunner;
  range: string;
  repoRoot: string;
}): ReadonlyMap<string, string> | null {
  const listing = git({ args: ["log", ...COMMON, "--name-only", "--format=%x00%H", range, "--"], cwd: repoRoot });
  return listing === null ? null : pathKeysIn({ listing });
}

/**
 * The verbatim patch id of each named commit, or `null` when git or the parse failed.
 *
 * @param git how to run git
 * @param shas the commits to hash, every one non-empty
 * @param repoRoot the repository to ask
 * @returns patch id by commit sha
 */
function patchIds({
  git,
  shas,
  repoRoot,
}: {
  git: GitRunner;
  shas: readonly string[];
  repoRoot: string;
}): ReadonlyMap<string, string> | null {
  // Untrimmed: the log's last line is the last commit's last diff line, and trimming it would make an added
  // `x ` hash as an added `x` — the very blindness this file exists to close.
  const log = git({ args: [...PATCH_LOG, "--no-walk", ...shas, "--"], cwd: repoRoot, untrimmed: true });
  if (log === null) {
    return null;
  }
  const listing = git({ args: ["patch-id", "--verbatim"], cwd: repoRoot, stdin: log });
  return listing === null ? null : patchIdsIn({ listing });
}

/**
 * Whether every commit in `trunk..branch` has a verbatim twin in `branch..trunk`, the two sides `git cherry`
 * compares.
 *
 * @param git how to run git
 * @param repoRoot the repository to ask
 * @param trunk the trunk ref
 * @param branch the branch to judge
 * @returns `true` absorbed, `false` not, `null` when git could not answer
 */
export function verbatimAbsorbed({
  branch,
  git,
  repoRoot,
  trunk,
}: {
  branch: string;
  git: GitRunner;
  repoRoot: string;
  trunk: string;
}): boolean | null {
  const branchKeys = pathKeys({ git, range: `${trunk}..${branch}`, repoRoot });
  const trunkKeys = pathKeys({ git, range: `${branch}..${trunk}`, repoRoot });
  if (branchKeys === null || trunkKeys === null) {
    return null;
  }
  const wanted = new Set([...branchKeys.values()].filter((key) => key.length > 0));
  if (wanted.size === 0) {
    return true;
  }
  const trunkCandidates = [...trunkKeys].filter(([, key]) => wanted.has(key)).map(([sha]) => sha);
  const covered = new Set(trunkCandidates.map((sha) => trunkKeys.get(sha)!));
  // A branch path set no trunk commit shares cannot be matched, and that answer costs no patch at all — which is
  // the common case for a branch the trunk has not taken.
  if ([...wanted].some((key) => !covered.has(key))) {
    return false;
  }
  const branchShas = [...branchKeys].filter(([, key]) => key.length > 0).map(([sha]) => sha);
  const ids = patchIds({ git, repoRoot, shas: [...branchShas, ...trunkCandidates] });
  if (ids === null) {
    return null;
  }
  return everyBranchPatchInTrunk({ branchKeys, ids, trunkCandidates });
}
