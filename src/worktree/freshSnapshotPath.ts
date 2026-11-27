/**
 * The one-off Codex snapshot tree — what it looks like on disk, and how old it must be before `worktree prune`
 * may take it.
 *
 * ## Why prune needs to know it
 *
 * `createTreeSnapshot` (`../codex/snapshot.ts`) is the fallback when every pooled slot is leased: it registers a
 * detached worktree at `<os tmpdir>/slopweaver-snap-<6 chars>/tree` and removes it on release. A process that dies
 * before release leaves it registered, and prune then read it as an ordinary detached tree — "a detached HEAD on no
 * remote, so nothing could recreate this tree" — and held it forever, or past the week-old waiver SALVAGED it,
 * pushing a synthetic snapshot commit to a remote branch. MEASURED: 31 of the hourly run's 87 held
 * trees were these, and the temp directory held 106 of them, 7.4 GB, 51 over a day old
 * (`du -sck "$TMPDIR"/slopweaver-snap-??????/tree | tail -1`). A snapshot is a frozen COPY of another tree, so nothing is
 * lost when it goes.
 *
 * ## Why an age, and why this one
 *
 * A Codex pass reads the snapshot as its `repoRoot` while working in its own scratch directory, so no live
 * process's cwd shows the snapshot in use. What bounds that use is the pass itself: `MAX_BOUND_SECONDS`
 * (`../codex/bounds.ts`) refuses any pass longer than 24 hours. A snapshot untouched for longer than that plus an
 * hour cannot belong to a pass still running, which is all the safety this needs — no lease marker, no reaper.
 * `unit/worktree/freshSnapshotPath.test.ts` reddens if the bound ever outgrows this age.
 */
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, sep } from "node:path";

import type { GitRunner } from "./pruneGit.js";
import { PRUNE_REMOTE } from "./pruneRemote.js";
import { privateHistoryWithinHead } from "./snapshotPrivateHistory.js";

/** The `mkdtemp` prefix every one-off snapshot's staging directory is minted with. */
export const FRESH_SNAPSHOT_PREFIX = "slopweaver-snap-";

/** How long a one-off snapshot must be untouched before prune takes it: the longest Codex pass, plus an hour. */
export const FRESH_SNAPSHOT_MIN_AGE_MS = 25 * 60 * 60 * 1000;

/**
 * The message `snapshotCommit` (`../codex/snapshot.ts`) gives every snapshot's synthetic commit — the one mark
 * the tree carries of who made it, so the creator and the prune read it from this one constant.
 */
export const FRESH_SNAPSHOT_COMMIT_MESSAGE = "slopweaver: frozen tree for one Codex pass";

/** The characters `mkdtemp` appends: six, from `[A-Za-z0-9]`. */
const MKDTEMP_SUFFIX = /^[A-Za-z0-9]{6}$/u;

/**
 * Whether `path` is a one-off snapshot's tree: exactly `<temp root>/slopweaver-snap-<6 chars>/tree` for one of the
 * given temp roots, AND checked out at a commit carrying {@link FRESH_SNAPSHOT_COMMIT_MESSAGE}. A pool slot
 * (`slopweaver-snap-pool/...`), anything deeper or shallower, and any other name are not — they are judged by the
 * ordinary rules. The shape alone is not provenance: a tree a person made at that path, with their own commit on
 * it, would be taken for a copy, so its HEAD must be the snapshot's own commit,
 * and a commit made on it since — any message, any date — moves HEAD off that, back to the ordinary rules. So
 * does one made and moved away from, still named in its private gitdir: judged only at removal, it was classed a
 * snapshot and declined on every run, owed forever.
 *
 * @param path the worktree path git registered
 * @param tempRoots every spelling of the OS temp directory — darwin registers `/private/var/...` for `/var/...`
 * @param git how to read the HEAD commit's message, asked only once the shape matches
 * @returns true only for the exact shape at a snapshot's own commit
 */
export function isFreshSnapshotTree({
  path,
  tempRoots,
  git,
}: {
  path: string;
  tempRoots: readonly string[];
  git: GitRunner;
}): boolean {
  if (!freshSnapshotShape({ path, tempRoots })) {
    return false;
  }
  return (
    isSnapshotCommit({ git, path, rev: "HEAD" }) &&
    snapshotWitnessed({ git, path, rev: "HEAD" }) &&
    privateHistoryWithinHead({ git, path, rev: "HEAD" })
  );
}

/**
 * The ref namespaces every worktree of a repository shares, so a tree's removal never takes one with it. Of the
 * remote-tracking refs only {@link PRUNE_REMOTE}'s count, as for every other backed-up read the prune makes.
 */
const SHARED_REFS = ["refs/heads/", "refs/tags/", `refs/remotes/${PRUNE_REMOTE}/`] as const;

/**
 * Whether everything a snapshot commit holds exists somewhere else, so removing its tree loses nothing.
 *
 * A snapshot is written with `-p HEAD` over a scratch index that took the source's uncommitted and untracked files
 * too (`../codex/snapshot.ts`), so it can be the last copy two ways: its parent is a
 * commit no branch, tag or remote carries, or its tree holds changes its source never committed. Either keeps it
 * out of the snapshot class, back on the ordinary rules, where a detached tree on no remote is held and past the
 * week-old waiver salvaged — pushed before it goes. The parent's ref is re-read at removal; its tree cannot change.
 *
 * **Only a branch, tag or `origin` remote-tracking ref is a witness.** A per-worktree ref (`refs/bisect/`, `refs/worktree/`,
 * `refs/rewritten/`) lives under the linked tree's own gitdir, so the removal it would authorise deletes it too and
 * leaves the parent unreachable. The three named namespaces are shared by every worktree.
 *
 * @param git how to run git
 * @param path the tree to read in
 * @param rev the snapshot commit, `HEAD` at the scan or the pinned sha at removal
 * @returns true only when the tree equals its parent's and a shared ref contains that parent
 */
export function snapshotWitnessed({ git, path, rev }: { git: GitRunner; path: string; rev: string }): boolean {
  const parent = git({ args: ["rev-parse", "--verify", "--quiet", `${rev}^`], cwd: path });
  if (parent === null || parent === "") {
    return false;
  }
  const tree = git({ args: ["rev-parse", `${rev}^{tree}`], cwd: path });
  if (tree === null || tree === "" || tree !== git({ args: ["rev-parse", `${parent}^{tree}`], cwd: path })) {
    return false;
  }
  const holder = git({
    args: ["for-each-ref", "--contains", parent, "--count=1", "--format=%(refname)", ...SHARED_REFS],
    cwd: path,
  });
  return holder !== null && holder !== "";
}

/**
 * Whether `rev` is a snapshot code's own commit, by its message. The scan asks it of HEAD; the removal asks it again
 * of the exact sha it pins, because HEAD can move between the scan's two reads of it, so only the pinned sha's own message ties provenance to what is removed.
 *
 * @param git how to run git
 * @param path the tree to read in
 * @param rev the commit to read, `HEAD` or a sha
 * @returns true only when that commit's whole message is {@link FRESH_SNAPSHOT_COMMIT_MESSAGE}
 */
export function isSnapshotCommit({ git, path, rev }: { git: GitRunner; path: string; rev: string }): boolean {
  return git({ args: ["log", "-1", "--format=%B", rev], cwd: path }) === FRESH_SNAPSHOT_COMMIT_MESSAGE;
}

/**
 * Whether `path` has exactly a one-off snapshot's shape under one of the temp roots.
 *
 * @param path the worktree path git registered
 * @param tempRoots every spelling of the OS temp directory
 * @returns true only for `<temp root>/slopweaver-snap-<6 chars>/tree`
 */
function freshSnapshotShape({ path, tempRoots }: { path: string; tempRoots: readonly string[] }): boolean {
  if (basename(path) !== "tree") {
    return false;
  }
  const staging = dirname(path);
  const name = basename(staging);
  if (!name.startsWith(FRESH_SNAPSHOT_PREFIX)) {
    return false;
  }
  if (!MKDTEMP_SUFFIX.test(name.slice(FRESH_SNAPSHOT_PREFIX.length))) {
    return false;
  }
  const parent = dirname(staging);
  return tempRoots.some((root) => stripTrailingSep({ path: root }) === parent);
}

/**
 * Why a one-off snapshot about to be removed must be kept after all, judged on its activity read NOW.
 *
 * The scan's stamp is not enough: a commit made onto the detached snapshot between the scan and the removal is
 * on no ref, so `git worktree remove` would delete its only checkout. A commit
 * dates the tree by its HEAD, so a fresh one reads warm here.
 *
 * @param activityMs the tree's activity stamp read just now, `null` when it could not be read
 * @param nowMs the instant the removal is judged at
 * @returns the reason to keep it, or null when it is still untouched past {@link FRESH_SNAPSHOT_MIN_AGE_MS}
 */
export function snapshotWarmReason({ activityMs, nowMs }: { activityMs: number | null; nowMs: number }): string | null {
  if (activityMs === null) {
    return "its activity could not be re-read before removal — kept";
  }
  if (nowMs - activityMs < FRESH_SNAPSHOT_MIN_AGE_MS) {
    return "it was touched since the scan, inside the longest Codex pass — kept";
  }
  return null;
}

/**
 * Both spellings of the OS temp directory a one-off snapshot can be registered under: darwin's `tmpdir()` is
 * `/var/folders/...`, and git records the realpath, `/private/var/folders/...` — every one of the 32 leaked
 * snapshots measured was registered under the second (`git worktree list --porcelain | grep slopweaver-snap-`).
 *
 * @returns the temp directory as Node names it, and as the filesystem resolves it
 */
export function osTempRoots(): readonly string[] {
  const root = tmpdir();
  if (!existsSync(root)) {
    return [root];
  }
  return [root, realpathSync(root)];
}

/**
 * A directory path without a trailing separator, so `/tmp/` and `/tmp` compare equal.
 *
 * @param path a directory path
 * @returns the same path with any trailing separator removed, the root itself excepted
 */
function stripTrailingSep({ path }: { path: string }): string {
  if (path.length > 1 && path.endsWith(sep)) {
    return path.slice(0, -1);
  }
  return path;
}
