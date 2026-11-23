/**
 * The merge guard's effectful measurement half — turns two local git refs into the {@link DiffPath}[] and
 * `baseGained` facts `../mergeGuard.js` (the PURE core, already written) decides over.
 *
 * Read-only, exactly like `src/codex/gitRun.ts`: `execFileSync` with an argv ARRAY, never a shell string,
 * and the environment is stripped of every `GIT_*` variable first (see {@link stripGitEnv} and the incident
 * it documents) so `cwd` is the only thing that decides which repository is read.
 *
 * ## `diff` is a plain TWO-TREE comparison, deliberately not GitHub's triple-dot
 *
 * `git diff <base> <head>` compares the two tips DIRECTLY — never `<base>...<head>` (merge-base-relative,
 * which is what GitHub's own "Files changed" tab shows). That choice is load-bearing, not a simplification:
 * `resurrectedDeletions` in `../mergeGuard.js` only has teeth against a path that is BOTH (a) reported
 * `deleted` in `diff` and (b) a member of `baseGained` (added to base strictly AFTER the merge-base). A path
 * present at the merge-base can never also be "added after the merge-base" — that is a contradiction, not an
 * edge case — so a merge-base-relative diff and a merge-base-relative `baseGained` can never overlap; the
 * finding this module exists to feed would be permanently, structurally unreachable.
 *
 * A two-tree diff against `base`'s CURRENT tip has no such conflict: it asks "what would `head`'s content
 * actually leave `base` looking like", which is exactly the fast-forward/`reset --soft` question, and it is
 * the diff a THIRD, divergent commit landing on `base` cannot silently satisfy the way a merge-base-relative
 * diff would. `--no-renames`, because {@link DiffPath}'s status union has no `renamed` member and a rename
 * split across two paths would silently vanish from either the added or the deleted side. `--numstat` and
 * `--name-status` are two separate invocations rather than one, because `--numstat` alone cannot tell an add
 * from a delete for a binary file (both print `-`), and `--name-status` alone carries no line counts.
 *
 * `baseGained` is answered by `git log --diff-filter=A --name-only <mergeBase>..<base>` — literally the
 * command the module header of `../mergeGuard.js` and the incident it documents describe, using the real
 * ancestral merge-base of `head` and `base`. `--format=format:` suppresses the commit metadata so the output
 * is nothing but filenames (and blank lines, filtered out), because the caller only wants the SET of paths,
 * never which commit added which.
 */

import { execFileSync } from "node:child_process";

import { stripGitEnv } from "../../codex/gitRun.js";
import { isRecord } from "../../lib/parsers.js";
import type { DiffPath, DiffStatus, RevertedPath } from "./mergeGuard.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/** The most git output this module will hold. A pull request whose diff exceeds this is not this guard's job. */
const MAX_GIT_BUFFER = 64 * 1024 * 1024;

/**
 * Run one git command, decoded as UTF-8 text, with the environment stripped of `GIT_*`.
 *
 * @param args the git argv, never a shell string
 * @param cwd the repository to run in
 * @param label what to call this step in a failure message
 * @returns stdout
 */
function runGit({ args, cwd, label }: { args: readonly string[]; cwd: string; label: string }): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: stripGitEnv({ env: process.env }),
      maxBuffer: MAX_GIT_BUFFER,
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ETIMEDOUT") {
      const minutes = String(GIT_READ_TIMEOUT_MS / 60_000);
      throw new Error(`${label} timed out: still running after ${minutes} minutes, so it was stopped`, {
        cause: error,
      });
    }
    const stderr = isRecord(error) ? error["stderr"] : undefined;
    let detail: string;
    if (typeof stderr === "string") {
      detail = stderr.trim();
    } else if (Buffer.isBuffer(stderr)) {
      detail = stderr.toString("utf8").trim();
    } else {
      detail = "";
    }
    throw new Error(`${label} failed${detail.length > 0 ? `: ${detail}` : ""}`, { cause: error });
  }
}

/** Split a `-z`-terminated git stream into its individual records, dropping the trailing empty entry. */
function splitNulRecords({ output }: { output: string }): readonly string[] {
  return output.split("\0").filter((entry) => entry.length > 0);
}

/**
 * Parse `git diff --numstat -z` output into removed-line counts per path.
 *
 * A binary file's counts print as `-`, which is not a number — its removal count is reported as 0 rather
 * than guessed, since nothing here can honestly say how many lines a binary file "removed".
 *
 * @param output the raw `--numstat -z` stdout
 * @returns removed-line count per path
 */
export function parseNumstatRemovals({ output }: { output: string }): ReadonlyMap<string, number> {
  const removals = new Map<string, number>();
  for (const record of splitNulRecords({ output })) {
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab <= 0 || secondTab <= firstTab) {
      continue;
    }
    const removed = Number(record.slice(firstTab + 1, secondTab));
    removals.set(record.slice(secondTab + 1), Number.isFinite(removed) ? removed : 0);
  }
  return removals;
}

/**
 * One `--name-status` letter as this guard reads it: `A` is added, `D` is deleted, and every other letter git
 * prints with `--no-renames` (`M`, a `T` type change, a `U` unmerged path) is a path still present on both sides,
 * which the guard treats as `modified`.
 */
function diffStatusOf({ letter }: { letter: string }): DiffStatus {
  if (letter === "A") {
    return "added";
  }
  if (letter === "D") {
    return "deleted";
  }
  return "modified";
}

/**
 * Parse `git diff --name-status -z` output into a status per path.
 *
 * With `-z`, git NUL-separates every field, not just the record — a plain entry prints as
 * `status\0path\0`, never `status\tpath\0` — so this pairs up flat tokens two at a time rather than
 * splitting each record on a tab. Run with `--no-renames`, so every pair is exactly one status and one path.
 *
 * @param output the raw `--name-status -z` stdout
 * @returns each path with its status, in the order git reported them
 */
export function parseNameStatus({ output }: { output: string }): readonly { path: string; status: DiffStatus }[] {
  const tokens = splitNulRecords({ output });
  const entries: { path: string; status: DiffStatus }[] = [];
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const letter = tokens[index]!.trim().charAt(0);
    entries.push({ path: tokens[index + 1]!, status: diffStatusOf({ letter }) });
  }
  return entries;
}

/**
 * Combine a diff's statuses with its removal counts into the {@link DiffPath}[] `../mergeGuard.js` expects.
 *
 * @param statuses each changed path with its status, in diff order
 * @param removals removed-line count per path
 * @returns one {@link DiffPath} per status entry, in the same order
 */
export function combineDiffPaths({
  statuses,
  removals,
}: {
  statuses: readonly { path: string; status: DiffStatus }[];
  removals: ReadonlyMap<string, number>;
}): readonly DiffPath[] {
  return statuses.map(({ path, status }) => ({ deleted: removals.get(path) ?? 0, path, status }));
}

/** A blob one commit wrote for one path. */
export interface HistoricalBlob {
  readonly commit: string;
  readonly blob: string;
}

/** The marker the raw history read prints before each commit id, so a commit line can never pass for a path. */
const COMMIT_MARKER = "\u0001";

/** An all-zero object id: what a `--raw` line prints as the new blob of a path that commit deleted. */
const NULL_OBJECT_ID = /^0+$/u;

/** How many path tokens follow a `--raw` meta token: two for a rename or copy (source, then destination), else one. */
function rawPathCount({ status }: { status: string | undefined }): number {
  if (status === undefined) {
    return 1;
  }
  return /^[RC]/u.test(status) ? 2 : 1;
}

/**
 * Parse `git log --raw --no-abbrev -z --format=%x01%H` into every blob each path held, most recent first.
 *
 * With `-z` the stream is flat NUL-separated tokens: `\x01<commit>`, then per changed path a `:<old mode> <new mode>
 * <old blob> <new blob> <status>` token followed by the path as its own token (git puts a newline before the first
 * meta token of a commit, trimmed here). The path is consumed by position, never matched, so a path holding a
 * colon or the marker cannot be misread. A rename or copy (status `R…`/`C…`) prints its source path and then its
 * destination, and the new blob is the destination's. The caller passes `--no-renames` so none is printed, but a
 * pair is still consumed whole, so a configured rename can never shift every later path by one. A deletion's new
 * blob is all zeros and is skipped: the path held no blob at that commit, which is what the per-commit read this
 * replaced reported too.
 *
 * @param output the raw stdout
 * @returns each path's blobs in the order git walked the commits, most recent first
 */
export function parseRawBlobHistory({ output }: { output: string }): ReadonlyMap<string, readonly HistoricalBlob[]> {
  const tokens = output.split("\0");
  const history = new Map<string, HistoricalBlob[]>();
  let commit: string | undefined;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!.replace(/^\n+/u, "");
    if (token.startsWith(COMMIT_MARKER)) {
      commit = token.slice(COMMIT_MARKER.length).trim();
      continue;
    }
    if (!token.startsWith(":") || commit === undefined) {
      continue;
    }
    const fields = token.slice(1).split(" ");
    const span = rawPathCount({ status: fields[4] });
    if (index + span >= tokens.length) {
      continue;
    }
    index += span;
    const path = tokens[index]!;
    const blob = fields[3];
    if (blob === undefined || NULL_OBJECT_ID.test(blob)) {
      continue;
    }
    const held = history.get(path);
    if (held === undefined) {
      history.set(path, [{ blob, commit }]);
    } else {
      held.push({ blob, commit });
    }
  }
  return history;
}

/**
 * Parse `git ls-tree -z` output into the object each path names: a blob, or a submodule's commit, whose pointer
 * moving back is a revert as much as a file's content is (the per-commit `rev-parse` this replaced resolved both).
 * A tree entry, a directory, is left out.
 *
 * @param output the raw stdout: `<mode> <type> <object>\t<path>` records, NUL-terminated
 * @returns the object id per path
 */
export function parseLsTreeBlobs({ output }: { output: string }): ReadonlyMap<string, string> {
  const blobs = new Map<string, string>();
  for (const record of splitNulRecords({ output })) {
    const tab = record.indexOf("\t");
    if (tab <= 0) {
      continue;
    }
    const [, type, object] = record.slice(0, tab).split(" ");
    if (type !== "tree" && object !== undefined) {
      blobs.set(record.slice(tab + 1), object);
    }
  }
  return blobs;
}

/**
 * The decision {@link measureRevertedFiles} makes, over facts already read: a path whose head blob is not base's
 * current one but IS one base's history held earlier restores that earlier content, and the match reported is the
 * most recent such commit.
 *
 * @param paths the modified paths to judge
 * @param headBlobs each path's blob on head; a path absent here is skipped
 * @param history each path's blobs on base, most recent first, index 0 its current one
 * @returns every reverted path with the base commit whose content it restores, sorted by path
 */
export function revertedPaths({
  paths,
  headBlobs,
  history,
}: {
  paths: readonly string[];
  headBlobs: ReadonlyMap<string, string>;
  history: ReadonlyMap<string, readonly HistoricalBlob[]>;
}): readonly RevertedPath[] {
  const reverted: RevertedPath[] = [];
  for (const path of paths) {
    const headBlob = headBlobs.get(path);
    const held = history.get(path);
    if (headBlob === undefined || held === undefined) {
      continue;
    }
    const [current, ...prior] = held;
    if (headBlob === current?.blob) {
      continue;
    }
    const match = prior.find((earlier) => earlier.blob === headBlob);
    if (match !== undefined) {
      reverted.push({ path, restoresBaseCommit: match.commit });
    }
  }
  return reverted.toSorted((left, right) => left.path.localeCompare(right.path));
}

/**
 * The most path bytes one git read is handed. A pull request's paths ride the argv, which the OS caps (darwin's
 * `ARG_MAX` is 1 MiB, environment included: `getconf ARG_MAX`), so a larger diff is read in more than one call,
 * each still one read for its slice. 1331 paths, the largest member measured, come to well under this.
 */
const PATHS_PER_READ_BYTES = 256 * 1024;

/**
 * Split paths into slices whose summed length stays under {@link PATHS_PER_READ_BYTES}; one slice per git read.
 *
 * @param paths the paths to slice, in order
 * @returns the slices, each non-empty, in order
 */
export function pathSlices({ paths }: { paths: readonly string[] }): readonly (readonly string[])[] {
  const slices: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const path of paths) {
    const size = Buffer.byteLength(path) + 1;
    if (current.length > 0 && bytes + size > PATHS_PER_READ_BYTES) {
      slices.push(current);
      current = [];
      bytes = 0;
    }
    current.push(path);
    bytes += size;
  }
  if (current.length > 0) {
    slices.push(current);
  }
  return slices;
}

/**
 * Paths this diff reports MODIFIED whose content on `head` matches a blob `base`'s own history for that path
 * once held, but no longer does — a proven silent revert.
 *
 * Deliberately does NOT compare against the merge-base. After a `git reset --soft base` squash, merge-base
 * `head base` degenerates to base's own current tip — see `baseAhead`'s header for the identical failure —
 * so "what changed since the fork" is unrecoverable through that lens; the squash discards the very ref that
 * would have named the true fork point. Walking base's OWN file history sidesteps the degenerate merge-base
 * entirely: it asks "did base ever hold exactly what head is proposing", which is true precisely when head is
 * carrying stale content forward, squashed or not.
 *
 * TWO reads, never one per past version. It used to run `git log` per path and `git rev-parse` per commit that
 * ever touched it, a child process each, which is where a seven-member batch dry run's 57 minutes went. `--raw`
 * prints the blob every commit wrote, so one history read carries what those thousands of children did, and one
 * `ls-tree` reads every head blob. Measured over one landed squash of 146 changed paths, the whole of
 * `measureMergeFacts` took 323.7s before and 3.85s after, reporting the same one reverted path at the same
 * commit. Repro, with `<squash>` any landed squash on the base: `time yarn tsx -e 'import("./src/outbound/github/mergeFacts.ts").then((m) => console.log(m.measureMergeFacts({ base: "<squash>^", cwd: ".", head: "<squash>" }).reverted))'`.
 *
 * `--literal-pathspecs`, because a path is a name and never a glob: the per-path walk read `*.ts` as a glob, so
 * it could name a later commit that only inherited the content, where this names the commit that wrote it. A
 * path that is not valid UTF-8 reaches both reads already decoded, matches nothing, and goes unmeasured, as it
 * did per path. `--no-show-signature` and `--no-color`, because a repository's `log.showSignature` prints a
 * verification line into the commit marker's own token, and the read would then silently drop that commit's blobs.
 * `--diff-merges=first-parent`, so a merge the
 * history walk keeps reports the blob it holds, which the per-commit read gave it. One residue differs from that
 * per-path walk: history simplification now runs over the slice's paths together, so a merge that kept one path
 * from each side is walked down both — a superset of base's blobs, never fewer, on a base whose history has
 * merges in it at all.
 *
 * @param cwd the repository to read
 * @param base the branch being merged into
 * @param head the branch being merged from
 * @param diff the pull request's own diff, already measured
 * @returns every reverted path with the base commit whose content it restores, sorted by path
 */
function measureRevertedFiles({
  cwd,
  base,
  head,
  diff,
}: {
  cwd: string;
  base: string;
  head: string;
  diff: readonly DiffPath[];
}): readonly RevertedPath[] {
  const paths = diff.filter((entry) => entry.status === "modified").map((entry) => entry.path);
  const headBlobs = new Map<string, string>();
  const history = new Map<string, readonly HistoricalBlob[]>();
  for (const slice of pathSlices({ paths })) {
    const tree = runGit({
      args: ["--literal-pathspecs", "ls-tree", "-r", "-z", "--full-tree", head, "--", ...slice],
      cwd,
      label: `git ls-tree ${head} (${String(slice.length)} path(s))`,
    });
    for (const [path, blob] of parseLsTreeBlobs({ output: tree })) {
      headBlobs.set(path, blob);
    }
    const log = runGit({
      args: [
        "--literal-pathspecs",
        "log",
        "--no-show-signature",
        "--no-color",
        "--no-renames",
        "--diff-merges=first-parent",
        "--raw",
        "--no-abbrev",
        "-z",
        "--format=%x01%H",
        base,
        "--",
        ...slice,
      ],
      cwd,
      label: `git log --raw ${base} (${String(slice.length)} path(s))`,
    });
    for (const [path, held] of parseRawBlobHistory({ output: log })) {
      history.set(path, held);
    }
  }
  return revertedPaths({ headBlobs, history, paths });
}

/**
 * Parse `git log --format=format: --diff-filter=A --name-only` output into the set of paths it named.
 *
 * Blank lines (the format's empty commit header, and the separators between commits) are filtered out
 * rather than treated as paths; what remains is de-duplicated by the `Set`.
 *
 * @param output the raw stdout
 * @returns the distinct paths named
 */
export function parseAddedPaths({ output }: { output: string }): ReadonlySet<string> {
  return new Set(
    output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
}

/** The facts `../mergeGuard.js` needs to decide over: the diff itself, and what the base gained since the fork. */
export interface MergeFacts {
  /** The pull request's OWN diff, merge-base relative — what GitHub shows and what a merge would apply. */
  readonly diff: readonly DiffPath[];
  /** Paths base holds that head has never seen, from the two tips directly — how far the base has moved. */
  readonly baseAhead: readonly string[];
  /** Paths whose proposed content base's own history once held, each with the commit it held it at. */
  readonly reverted: readonly RevertedPath[];
  /**
   * The exact commit `base` resolved to, and the exact commit `head` did. Reported rather than assumed
   * because a verdict computed against a ref the caller did not mean reads exactly like a true one — the
   * failure class this whole module is one fix of. Whoever reads the report can check these in one command.
   */
  readonly baseSha: string;
  readonly headSha: string;
}

/**
 * Measure a pull request's diff and the base branch's own history, from two LOCAL git refs.
 *
 * `base` and `head` must be refs this repository can already resolve (a local branch, or a remote-tracking
 * one such as `origin/main`) — this module fetches nothing.
 *
 * @param cwd the git repository to read (its root, or any directory inside it)
 * @param base the branch being merged into
 * @param head the branch being merged from
 * @returns the measured facts
 */
export function measureMergeFacts({ cwd, base, head }: { cwd: string; base: string; head: string }): MergeFacts {
  // MERGE-BASE relative (`...`), which is what GitHub renders and what a merge would apply. A two-tree
  // comparison reports every file base gained while the branch was in flight as a DELETION — measured on this
  // guard's own pull request, that invented ten of them, each labelled "almost certainly unintended", while
  // GitHub's diff showed none. Findings a merge would not cause are worse than no findings, because the real
  // ones sit in the same list.
  const range = `${base}...${head}`;
  const nameStatus = runGit({
    args: ["diff", "--no-renames", "--name-status", "-z", range],
    cwd,
    label: `git diff --name-status ${range}`,
  });
  const numstat = runGit({
    args: ["diff", "--no-renames", "--numstat", "-z", range],
    cwd,
    label: `git diff --numstat ${range}`,
  });
  // How far base has moved. BOTH halves are needed and the intersection is the point: paths base ADDED after
  // the fork (so the branch has never seen them) that head also lacks NOW. Taking only the second half — every
  // path head lacks — reported all 48 files this very pull request deliberately deletes, which is the same
  // "findings a merge would not cause" failure the diff mode above already had to be rescued from.
  const mergeBase = runGit({ args: ["merge-base", head, base], cwd, label: `git merge-base ${head} ${base}` }).trim();
  const addedOnBase = parseAddedPaths({
    output: runGit({
      args: ["log", "--format=format:", "--diff-filter=A", "--name-only", "--no-renames", `${mergeBase}..${base}`],
      cwd,
      label: `git log ${mergeBase}..${base}`,
    }),
  });
  const missingFromHead = new Set(
    runGit({
      args: ["diff", "--no-renames", "--diff-filter=D", "--name-only", "-z", base, head],
      cwd,
      label: `git diff --diff-filter=D ${base} ${head}`,
    })
      .split("\0")
      .filter((path) => path.length > 0),
  );
  const diff = combineDiffPaths({
    removals: parseNumstatRemovals({ output: numstat }),
    statuses: parseNameStatus({ output: nameStatus }),
  });
  return {
    baseAhead: [...addedOnBase].filter((path) => missingFromHead.has(path)).toSorted(),
    baseSha: runGit({ args: ["rev-parse", `${base}^{commit}`], cwd, label: `git rev-parse ${base}` }).trim(),
    diff,
    headSha: runGit({ args: ["rev-parse", `${head}^{commit}`], cwd, label: `git rev-parse ${head}` }).trim(),
    reverted: measureRevertedFiles({ base, cwd, diff, head }),
  };
}
